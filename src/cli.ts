#!/usr/bin/env tsx
/**
 * purify — AISP round-trip spec purification
 *
 * Usage:
 *   purify [options] [file]
 *   purify [options] "inline text"
 *   cat spec.md | purify [options]
 *
 * Options:
 *   --provider   anthropic | openai                        (default: anthropic)
 *   --model      main model (AISP→English)                 (default: provider default)
 *   --purify-model  cheap model (En→AISP)                  (default: haiku / gpt-4o-mini)
 *   --mode       formal | narrative | hybrid | sketch | summary  (default: narrative)
 *   --mode-file  path to a skill markdown file that specifies the mode
 *   --api-key    API key                                    (default: env var)
 *   --verbose    write AISP and scores to stderr
 *   --help
 *
 * Environment:
 *   ANTHROPIC_API_KEY  OPENAI_API_KEY
 *   PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP
 *   PURIFY_MODE_FILE   path to a skill markdown file (overridden by --mode-file)
 *
 * Output:
 *   QUALITY: <tier_symbol> <tier_name> (δ=<score>, validator_δ=<score>)
 *   ---
 *   <purified English>        — or —
 *   NEEDS_CLARIFICATION
 *   <numbered questions>
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { createInterface } from "readline"
import Anthropic from "@anthropic-ai/sdk"
import { purify, eprint } from "./core.ts"
import { callLLM, callLLMRepl, callLLMWithTools, DEFAULT_MODELS, DEFAULT_CHEAP_MODELS } from "./providers.ts"
import { runValidator, parseEvidence, TIER_NAMES } from "./validator.ts"
import { TO_AISP_SYSTEM, APPLY_SUGGESTION_SYSTEM, getReplSystem } from "./prompts.ts"
import type { Provider, Mode, ConvMessage } from "./types.ts"

// ── CLI helpers ────────────────────────────────────────────────────────────────

function resolveInput(positional: string[]): string | null {
  if (positional.length > 0) {
    const joined = positional.join(" ")
    if (positional.length === 1 && existsSync(positional[0])) {
      return readFileSync(positional[0], "utf8")
    }
    return joined
  }
  if (!process.stdin.isTTY) {
    return readFileSync("/dev/stdin", "utf8")
  }
  return null
}

function resolveApiKey(provider: Provider, explicit: string | null): string {
  if (explicit) return explicit
  const envVars: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai:    "OPENAI_API_KEY",
  }
  const key = process.env[envVars[provider]]
  if (!key) {
    process.stderr.write(`error: set ${envVars[provider]} or use --api-key\n`)
    process.exit(1)
  }
  return key
}

const VALID_MODES: Mode[] = ["formal", "narrative", "hybrid", "sketch", "summary"]

/**
 * Parse a skill markdown file and extract the mode from it.
 *
 * Reads the mode from YAML frontmatter (`mode: <value>`) or from a
 * `## Mode` section (first non-empty line after the heading).
 */
function parseModeFile(filePath: string): Mode {
  if (!existsSync(filePath)) {
    process.stderr.write(`error: mode file not found: ${filePath}\n`)
    process.exit(1)
  }

  const content = readFileSync(filePath, "utf8")

  // Try YAML frontmatter first: look for `mode: <value>` between --- delimiters
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/m)
  if (frontmatterMatch) {
    const modeMatch = frontmatterMatch[1].match(/^mode:\s*(\S+)/m)
    if (modeMatch) {
      const mode = modeMatch[1].toLowerCase() as Mode
      if (!VALID_MODES.includes(mode)) {
        process.stderr.write(`error: invalid mode "${mode}" in ${filePath}. Valid modes: ${VALID_MODES.join(", ")}\n`)
        process.exit(1)
      }
      return mode
    }
  }

  // Fall back to ## Mode section
  const modeSectionMatch = content.match(/^##\s+Mode\s*\r?\n([\s\S]*?)(?:^##|\Z)/m)
  if (modeSectionMatch) {
    const firstLine = modeSectionMatch[1].split(/\r?\n/).find(l => l.trim())?.trim().toLowerCase() as Mode | undefined
    if (firstLine && VALID_MODES.includes(firstLine)) {
      return firstLine
    }
  }

  process.stderr.write(`error: no valid mode found in ${filePath}. Add "mode: <value>" to frontmatter or a "## Mode" section.\n`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const positional: string[] = []
  const opts = {
    provider:     (process.env.PURIFY_PROVIDER ?? "anthropic") as Provider,
    model:        null as string | null,
    purifyModel:  null as string | null,
    apiKey:       null as string | null,
    baseUrl:      (process.env.OPENAI_BASE_URL ?? null) as string | null,
    openaiUser:   (process.env.OPENAI_USER ?? null) as string | null,
    mode:         (process.env.PURIFY_MODE ?? "narrative") as Mode,
    modeFile:     (process.env.PURIFY_MODE_FILE ?? null) as string | null,
    verbose:      false,
    fromAisp:     false,
    repl:         false,
    suggest:      false,
    thinking:     false,
    estimate:     false,
    help:         false,
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--help" || a === "-h")          { opts.help = true }
    else if (a === "--verbose")                 { opts.verbose = true }
    else if (a === "--from-aisp")               { opts.fromAisp = true }
    else if (a === "--repl")                    { opts.repl = true }
    else if (a === "--suggest")                 { opts.suggest = true }
    else if (a === "--thinking")                { opts.thinking = true }
    else if (a === "--estimate")                { opts.estimate = true }
    else if (a === "--provider")                { opts.provider = args[++i] as Provider }
    else if (a === "--model")                   { opts.model = args[++i] }
    else if (a === "--purify-model")            { opts.purifyModel = args[++i] }
    else if (a === "--mode")                    { opts.mode = args[++i] as Mode }
    else if (a === "--mode-file")               { opts.modeFile = args[++i] }
    else if (a === "--formal")                  { opts.mode = "formal" }
    else if (a === "--narrative")               { opts.mode = "narrative" }
    else if (a === "--hybrid")                  { opts.mode = "hybrid" }
    else if (a === "--sketch")                  { opts.mode = "sketch" }
    else if (a === "--summary")                 { opts.mode = "summary" }
    else if (a === "--api-key")                 { opts.apiKey = args[++i] }
    else if (a === "--base-url")                { opts.baseUrl = args[++i] }
    else if (a === "--user")                    { opts.openaiUser = args[++i] }
    else if (!a.startsWith("--"))               { positional.push(a) }
    else {
      process.stderr.write(`error: unknown option ${a}\n`)
      process.exit(1)
    }
  }

  // Resolve mode from file if provided (mode file takes precedence over env var,
  // but explicit --mode / --formal etc. flags take precedence over mode file)
  const modeSetByFlag = argv.slice(2).some(a =>
    a === "--mode" || a === "--formal" || a === "--narrative" ||
    a === "--hybrid" || a === "--sketch" || a === "--summary"
  )
  if (opts.modeFile && !modeSetByFlag) {
    opts.mode = parseModeFile(opts.modeFile)
  }

  return { opts, positional }
}

function printHelp() {
  console.log(`\
purify — AISP round-trip spec purification

Usage:
  purify [options] [file]
  purify [options] "inline text"
  cat spec.md | purify

Options:
  --provider     anthropic | openai                          (default: anthropic)
  --model        main model (AISP→English)                   (default: claude-sonnet-4-6)
  --purify-model cheap model (En→AISP)                       (default: claude-haiku-4-5-20251001)
  --mode         formal|narrative|hybrid|sketch|summary      (default: narrative)
  --mode-file    path to a skill markdown file that specifies the mode
  --api-key      API key                                     (default: env var)
  --base-url     OpenAI-compatible base URL                  (default: OPENAI_BASE_URL)
  --user         OpenAI user identifier for tracking         (default: OPENAI_USER)
  --from-aisp    skip step 1 — input is already AISP
  --repl         interactive session with chat context and prompt caching
  --suggest      show purified version then suggest changes applied to the original
  --thinking     enable extended thinking for Step 3 (Anthropic Sonnet/Opus only)
  --estimate     count input tokens for Step 1 and exit without calling the main model
  --verbose      write AISP and scores to stderr
  --help

Modes:
  formal     Full precision; tables and notation throughout
  narrative  Flowing prose with symbolic anchors (default)
  hybrid     Balanced prose and notation
  sketch     High-level overview; bullet list; minimal symbols
  summary    Plain English; no notation; executive summary

Mode files:
  A skill markdown file with a "mode:" key in YAML frontmatter or a "## Mode"
  section. Example: purify --mode-file .claude/skills/sketch-mode.md

Environment:
  ANTHROPIC_API_KEY  OPENAI_API_KEY  OPENAI_BASE_URL  OPENAI_USER
  PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP  PURIFY_MODE
  PURIFY_MODE_FILE   path to a skill markdown file (overridden by --mode-file)

Output:
  QUALITY: <tier> <name> (δ=<validator_score>, self_δ=<self_score>)
  ---
  <purified English or NEEDS_CLARIFICATION block>

Examples:
  purify spec.md > purified.md
  purify "add a status field with draft, active, archived"
  purify spec.md --verbose 2>aisp_debug.md
  purify spec.md --purify-model claude-haiku-4-5-20251001
`)
}

async function runRepl(opts: {
  provider: Provider
  mainModel: string
  purifyModel: string
  apiKey: string
  verbose: boolean
  mode: Mode
  fromAisp: boolean
  baseUrl: string | null
  openaiUser: string | null
}): Promise<void> {
  const { provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp, baseUrl, openaiUser } = opts
  const messages: ConvMessage[] = []

  const rl = createInterface({ input: process.stdin })

  process.stderr.write(
    `purify repl — empty line to submit, /exit or ctrl-c to quit\n` +
    `provider=${provider}  purify=${purifyModel}  model=${mainModel}  mode=${mode}\n\n`,
  )
  process.stderr.write("➤ ")

  // Handle Ctrl-C cleanly
  process.on("SIGINT", () => {
    process.stderr.write("\nexiting...\n")
    rl.close()
    process.exit(0)
  })

  let buffer: string[] = []

  for await (const line of rl) {
    if (line !== "") {
      buffer.push(line)
      continue
    }

    // Empty line = submit
    if (buffer.length === 0) {
      process.stderr.write("➤ ")
      continue
    }

    if (buffer.length > 1000) {
      process.stderr.write("⊘ buffer overflow — resetting\n➤ ")
      buffer = []
      continue
    }

    const input = buffer.join("\n")
    buffer = []

    if (input.trim() === "/exit") break

    try {
      // Step 1: English → AISP (unless --from-aisp)
      // Anthropic: use tool-use loop so the model can self-validate and revise
      let aisp = input
      if (!fromAisp) {
        process.stderr.write(`→ purifying (${purifyModel})...\n`)
        aisp = provider === "anthropic"
          ? await callLLMWithTools(apiKey, purifyModel, input)
          : await callLLM(provider, apiKey, purifyModel, TO_AISP_SYSTEM, input, { baseUrl: baseUrl ?? undefined, openaiUser: openaiUser ?? undefined })
      }

      if (verbose) {
        process.stderr.write("\n── AISP ──\n" + aisp + "\n──────────\n\n")
      }

      // Validate and score the AISP
      const vr    = await runValidator(aisp)
      const self  = parseEvidence(aisp)
      const delta = vr?.delta ?? self.delta
      const tierSym = delta === null ? "⊘"
        : delta >= 0.75 ? "◊⁺⁺" : delta >= 0.60 ? "◊⁺"
        : delta >= 0.40 ? "◊"   : delta >= 0.20 ? "◊⁻" : "⊘"
      const tierName  = TIER_NAMES[tierSym] ?? "unknown"
      const deltaStr  = delta !== null ? `δ=${delta.toFixed(2)}` : "δ=?"
      const selfStr   = self.delta !== null ? `, self_δ=${self.delta.toFixed(2)}` : ""
      process.stderr.write(`QUALITY: ${tierSym} ${tierName} (${deltaStr}${selfStr})\n`)

      // Step 3: AISP → English via main model with full conversation history (streamed)
      messages.push({ role: "user", content: aisp })
      process.stderr.write(`→ translating (${mainModel})...\n`)
      process.stdout.write("\n")
      const response = await callLLMRepl(provider, apiKey, mainModel, getReplSystem(mode), messages, process.stdout, { baseUrl: baseUrl ?? undefined, openaiUser: openaiUser ?? undefined })
      messages.push({ role: "assistant", content: response })

      process.stdout.write("\n\n")
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      // Roll back the user message if we never got a response
      if (messages.at(-1)?.role === "user") messages.pop()
    }

    process.stderr.write("➤ ")
  }

  process.stderr.write("\nexiting...\n")
}

async function runSuggest(opts: {
  provider: Provider
  mainModel: string
  purifyModel: string
  apiKey: string
  verbose: boolean
  mode: Mode
  fromAisp: boolean
  inputFile: string | null
  initialText: string
  baseUrl: string | null
  openaiUser: string | null
}): Promise<void> {
  const { provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp, inputFile, baseUrl, openaiUser } = opts
  let currentText = opts.initialText

  const rl = createInterface({ input: process.stdin })

  process.stderr.write(
    `purify suggest — show purified version and suggest changes to the original\n` +
    `provider=${provider}  purify=${purifyModel}  model=${mainModel}  mode=${mode}\n` +
    `commands: empty line to submit · /save to write file · /exit to quit\n\n`,
  )

  process.on("SIGINT", () => {
    process.stderr.write("\nexiting...\n")
    rl.close()
    process.exit(0)
  })

  async function doPurify(): Promise<string> {
    const result = await purify({
      text: currentText,
      provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp,
      baseUrl: baseUrl ?? undefined, openaiUser: openaiUser ?? undefined,
    })
    process.stdout.write("\n── PURIFIED VERSION ──\n" + result + "\n── END PURIFIED ──\n\n")
    return result
  }

  // Initial purify
  process.stderr.write(`→ purifying initial input...\n`)
  let purifiedResult = await doPurify()

  process.stderr.write("➤ ")

  let buffer: string[] = []

  for await (const line of rl) {
    if (line !== "") {
      buffer.push(line)
      continue
    }

    if (buffer.length === 0) {
      process.stderr.write("➤ ")
      continue
    }

    const input = buffer.join("\n").trim()
    buffer = []

    if (input === "/exit") break

    if (input === "/save") {
      if (!inputFile) {
        process.stderr.write("⊘ no input file to save to — pass a file path as the argument\n")
      } else {
        writeFileSync(inputFile, currentText, "utf8")
        process.stderr.write(`✓ saved to ${inputFile}\n`)
      }
      process.stderr.write("➤ ")
      continue
    }

    try {
      process.stderr.write(`→ applying suggestion...\n`)
      const userMsg = [
        "ORIGINAL:",
        currentText,
        "",
        "PURIFIED:",
        purifiedResult,
        "",
        "SUGGESTION:",
        input,
      ].join("\n")

      currentText = await callLLM(provider, apiKey, mainModel, APPLY_SUGGESTION_SYSTEM, userMsg, { baseUrl: baseUrl ?? undefined, openaiUser: openaiUser ?? undefined })

      process.stdout.write("\n── UPDATED ORIGINAL ──\n" + currentText + "\n── END ORIGINAL ──\n\n")

      process.stderr.write(`→ re-purifying...\n`)
      purifiedResult = await doPurify()
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
    }

    process.stderr.write("➤ ")
  }

  process.stderr.write("\nexiting...\n")
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { opts, positional } = parseArgs(process.argv)

  if (opts.help) {
    printHelp()
    process.exit(0)
  }

  if (opts.repl) {
    const provider    = opts.provider
    const mainModel   = opts.model       ?? process.env.PURIFY_MODEL       ?? DEFAULT_MODELS[provider]
    const purifyModel = opts.purifyModel ?? process.env.PURIFY_MODEL_CHEAP ?? DEFAULT_CHEAP_MODELS[provider]
    const apiKey      = resolveApiKey(provider, opts.apiKey)
    await runRepl({ provider, mainModel, purifyModel, apiKey, verbose: opts.verbose, mode: opts.mode, fromAisp: opts.fromAisp, baseUrl: opts.baseUrl, openaiUser: opts.openaiUser })
    process.exit(0)
  }

  if (opts.suggest) {
    const text = resolveInput(positional)
    if (!text?.trim()) {
      process.stderr.write("error: --suggest requires an input file or inline text\n")
      process.exit(1)
    }
    const provider    = opts.provider
    const mainModel   = opts.model       ?? process.env.PURIFY_MODEL       ?? DEFAULT_MODELS[provider]
    const purifyModel = opts.purifyModel ?? process.env.PURIFY_MODEL_CHEAP ?? DEFAULT_CHEAP_MODELS[provider]
    const apiKey      = resolveApiKey(provider, opts.apiKey)
    const inputFile   = positional.length === 1 && existsSync(positional[0]) ? positional[0] : null
    await runSuggest({ provider, mainModel, purifyModel, apiKey, verbose: opts.verbose, mode: opts.mode, fromAisp: opts.fromAisp, inputFile, initialText: text!, baseUrl: opts.baseUrl, openaiUser: opts.openaiUser })
    process.exit(0)
  }

  const text = resolveInput(positional)
  if (!text?.trim()) {
    printHelp()
    process.exit(0)
  }

  const provider   = opts.provider
  const mainModel  = opts.model        ?? process.env.PURIFY_MODEL        ?? DEFAULT_MODELS[provider]
  const purifyModel = opts.purifyModel ?? process.env.PURIFY_MODEL_CHEAP  ?? DEFAULT_CHEAP_MODELS[provider]
  const apiKey     = resolveApiKey(provider, opts.apiKey)

  if (opts.estimate) {
    if (provider !== "anthropic") {
      process.stderr.write("error: --estimate is only supported with --provider anthropic\n")
      process.exit(1)
    }
    const client = new Anthropic({ apiKey })
    const count = await client.messages.countTokens({
      model: purifyModel,
      system: (await import("./providers.ts")).TO_AISP_SYSTEM_WITH_TOOLS,
      messages: [{ role: "user", content: text! }],
    })
    process.stdout.write(
      `Step 1 input tokens (${purifyModel}): ${count.input_tokens}\n` +
      `(Step 3 tokens depend on AISP output — run without --estimate for full output)\n`,
    )
    process.exit(0)
  }

  eprint(`purify: provider=${provider} purify=${purifyModel} main=${mainModel} mode=${opts.mode}`, opts.verbose)

  try {
    await purify({
      text: text!,
      provider,
      mainModel,
      fromAisp: opts.fromAisp,
      purifyModel,
      apiKey,
      verbose: opts.verbose,
      mode: opts.mode,
      thinking: opts.thinking,
      stream: true,
      baseUrl: opts.baseUrl ?? undefined,
      openaiUser: opts.openaiUser ?? undefined,
    })
    process.stdout.write("\n")
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

main()
