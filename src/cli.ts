#!/usr/bin/env tsx

/**
 * purify — AISP round-trip spec purification
 *
 * Usage:
 *   purify [options] -f <path> | "inline text" | stdin
 *   purify -f spec.md
 *   purify "inline text"
 *   cat spec.md | purify [options]
 *
 * File input requires --input / -f; positional args are always literal strings (never paths).
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

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import Anthropic from "@anthropic-ai/sdk"
import { eprint, purify } from "./core.ts"
import {
  APPLY_SUGGESTION_SYSTEM,
  formatPrimaryWithAuthorContext,
  formatReplSystemWithContext,
  getReplSystem,
  TO_AISP_SYSTEM,
} from "./prompts.ts"
import {
  callLLM,
  callLLMRepl,
  callLLMWithTools,
  DEFAULT_CHEAP_MODELS,
  DEFAULT_MODELS,
  TO_AISP_SYSTEM_WITH_TOOLS,
} from "./providers.ts"
import type { ContextFile, ConvMessage, Mode, Provider } from "./types.ts"
import { parseEvidence, runValidator, TIER_NAMES } from "./validator.ts"

// ── Error logging ──────────────────────────────────────────────────────────────

function logError(err: unknown): void {
  if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`)
    // HTTP/network errors from Anthropic or OpenAI SDKs expose status + headers
    const e = err as unknown as Record<string, unknown>
    if (e.status !== undefined) process.stderr.write(`  status: ${e.status}\n`)
    if (e.code !== undefined) process.stderr.write(`  code: ${e.code}\n`)
    if (e.url !== undefined) process.stderr.write(`  url: ${e.url}\n`)
    // OpenAI APIError exposes the raw response body
    if (e.error !== undefined)
      process.stderr.write(`  body: ${JSON.stringify(e.error)}\n`)
    if (err.cause !== undefined)
      process.stderr.write(`  cause: ${String(err.cause)}\n`)
  } else {
    process.stderr.write(`error: ${String(err)}\n`)
  }
}

// ── CLI helpers ────────────────────────────────────────────────────────────────

/** I1/I2: explicit file flag, positional = literal string only, else stdin pipe. */
function resolvePrimaryText(
  inputFile: string | null,
  positional: string[],
): string | null {
  if (inputFile) {
    try {
      return readFileSync(inputFile, "utf8")
    } catch {
      process.stderr.write(`error: cannot read --input file: ${inputFile}\n`)
      process.exit(1)
    }
  }
  if (positional.length > 0) {
    return positional.join(" ")
  }
  if (!process.stdin.isTTY) {
    try {
      return readFileSync("/dev/stdin", "utf8")
    } catch {
      process.stderr.write("error: cannot read stdin\n")
      process.exit(1)
    }
  }
  return null
}

function ensureNoInputFileAndPositionalConflict(
  inputFile: string | null,
  positional: string[],
): void {
  if (inputFile && positional.length > 0) {
    process.stderr.write(
      "error: use either --input/-f <path> or inline positional text, not both\n",
    )
    process.exit(1)
  }
}

function loadContextFiles(paths: string[]): ContextFile[] {
  return paths.map((p) => {
    if (!existsSync(p)) {
      process.stderr.write(`error: context file not found: ${p}\n`)
      process.exit(1)
    }
    try {
      return { path: p, content: readFileSync(p, "utf8") }
    } catch {
      process.stderr.write(`error: cannot read context file: ${p}\n`)
      process.exit(1)
    }
  })
}

async function formatReplQualityLine(aisp: string): Promise<string> {
  const vr = await runValidator(aisp)
  const self = parseEvidence(aisp)
  const delta = vr?.delta ?? self.delta
  const tierSym =
    delta === null
      ? "⊘"
      : delta >= 0.75
        ? "◊⁺⁺"
        : delta >= 0.6
          ? "◊⁺"
          : delta >= 0.4
            ? "◊"
            : delta >= 0.2
              ? "◊⁻"
              : "⊘"
  const tierName = TIER_NAMES[tierSym] ?? "unknown"
  const deltaStr = delta !== null ? `δ=${delta.toFixed(2)}` : "δ=?"
  const selfStr =
    self.delta !== null ? `, self_δ=${self.delta.toFixed(2)}` : ""
  return `QUALITY: ${tierSym} ${tierName} (${deltaStr}${selfStr})`
}

function resolveApiKey(provider: Provider, explicit: string | null): string {
  if (explicit) return explicit
  const envVars: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  }
  const key = process.env[envVars[provider]]
  if (!key) {
    process.stderr.write(`error: set ${envVars[provider]} or use --api-key\n`)
    process.exit(1)
  }
  return key
}

const VALID_MODES: Mode[] = [
  "formal",
  "narrative",
  "hybrid",
  "sketch",
  "summary",
]

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
        process.stderr.write(
          `error: invalid mode "${mode}" in ${filePath}. Valid modes: ${VALID_MODES.join(", ")}\n`,
        )
        process.exit(1)
      }
      return mode
    }
  }

  // Fall back to ## Mode section
  const modeSectionMatch = content.match(
    /^##\s+Mode\s*\r?\n([\s\S]*?)(?:^##|Z)/m,
  )
  if (modeSectionMatch) {
    const firstLine = modeSectionMatch[1]
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim()
      .toLowerCase() as Mode | undefined
    if (firstLine && VALID_MODES.includes(firstLine)) {
      return firstLine
    }
  }

  process.stderr.write(
    `error: no valid mode found in ${filePath}. Add "mode: <value>" to frontmatter or a "## Mode" section.\n`,
  )
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const positional: string[] = []
  const opts = {
    provider: (process.env.PURIFY_PROVIDER ?? "anthropic") as Provider,
    model: null as string | null,
    purifyModel: null as string | null,
    apiKey: null as string | null,
    baseUrl: (process.env.OPENAI_BASE_URL ?? null) as string | null,
    openaiUser: (process.env.OPENAI_USER ?? null) as string | null,
    insecure: process.env.OPENAI_INSECURE === "1",
    mode: (process.env.PURIFY_MODE ?? "narrative") as Mode,
    modeFile: (process.env.PURIFY_MODE_FILE ?? null) as string | null,
    verbose: false,
    fromAisp: false,
    repl: false,
    suggest: false,
    thinking: false,
    estimate: false,
    help: false,
    inputFile: null as string | null,
    feedback: null as string | null,
    outputFile: null as string | null,
    contextFiles: [] as string[],
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--help" || a === "-h") {
      opts.help = true
    } else if (a === "-f" || a === "--input") {
      const p = args[++i]
      if (!p || p.startsWith("-")) {
        process.stderr.write(`error: ${a} requires a file path\n`)
        process.exit(1)
      }
      opts.inputFile = p
    } else if (a === "--feedback") {
      const p = args[++i]
      if (p === undefined) {
        process.stderr.write(
          "error: --feedback requires a value (quote if it contains spaces)\n",
        )
        process.exit(1)
      }
      opts.feedback = p
    } else if (a === "-o" || a === "--output") {
      const p = args[++i]
      if (!p || p.startsWith("-")) {
        process.stderr.write(`error: ${a} requires a file path\n`)
        process.exit(1)
      }
      opts.outputFile = p
    } else if (a === "--verbose") {
      opts.verbose = true
    } else if (a === "--from-aisp") {
      opts.fromAisp = true
    } else if (a === "--repl") {
      opts.repl = true
    } else if (a === "--suggest") {
      opts.suggest = true
    } else if (a === "--thinking") {
      opts.thinking = true
    } else if (a === "--estimate") {
      opts.estimate = true
    } else if (a === "--provider") {
      opts.provider = args[++i] as Provider
    } else if (a === "--model") {
      opts.model = args[++i]
    } else if (a === "--purify-model") {
      opts.purifyModel = args[++i]
    } else if (a === "--mode") {
      opts.mode = args[++i] as Mode
    } else if (a === "--mode-file") {
      opts.modeFile = args[++i]
    } else if (a === "--formal") {
      opts.mode = "formal"
    } else if (a === "--narrative") {
      opts.mode = "narrative"
    } else if (a === "--hybrid") {
      opts.mode = "hybrid"
    } else if (a === "--sketch") {
      opts.mode = "sketch"
    } else if (a === "--summary") {
      opts.mode = "summary"
    } else if (a === "-c" || a === "--context") {
      const p = args[++i]
      if (!p || p.startsWith("-")) {
        process.stderr.write(`error: ${a} requires a file path\n`)
        process.exit(1)
      }
      opts.contextFiles.push(p)
    } else if (a === "--api-key") {
      opts.apiKey = args[++i]
    } else if (a === "--base-url") {
      opts.baseUrl = args[++i]
    } else if (a === "--user") {
      opts.openaiUser = args[++i]
    } else if (a === "--insecure") {
      opts.insecure = true
    } else if (!a.startsWith("--")) {
      positional.push(a)
    } else {
      process.stderr.write(`error: unknown option ${a}\n`)
      process.exit(1)
    }
  }

  // Resolve mode from file if provided (mode file takes precedence over env var,
  // but explicit --mode / --formal etc. flags take precedence over mode file)
  const modeSetByFlag = argv
    .slice(2)
    .some(
      (a) =>
        a === "--mode" ||
        a === "--formal" ||
        a === "--narrative" ||
        a === "--hybrid" ||
        a === "--sketch" ||
        a === "--summary",
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
  purify [options] -f <path> | "inline text" | stdin
  purify -f spec.md
  purify "inline text"
  cat spec.md | purify

  Positional arguments are always treated as literal text (not file paths).
  Use -f / --input for file input. Do not combine -f with positional text.

Options:
  --input, -f    read primary specification from this file path
  --context, -c  add a file as reference context (repeatable); e.g. --context style-guide.md -c api-types.ts
  --feedback     author context for one shot (clarifications / extra context / suggestion); quote for spaces
  --output, -o   write final English to this path (batch: full stdout payload; REPL: last assistant reply on /exit or EOF)
  --provider     anthropic | openai                          (default: anthropic)
  --model        main model (AISP→English)                   (default: claude-sonnet-4-6)
  --purify-model cheap model (En→AISP)                       (default: claude-haiku-4-5-20251001)
  --mode         formal|narrative|hybrid|sketch|summary      (default: narrative)
  --mode-file    path to a skill markdown file that specifies the mode
  --api-key      API key                                     (default: env var)
  --base-url     OpenAI-compatible base URL                  (default: OPENAI_BASE_URL)
  --user         OpenAI user identifier for tracking         (default: OPENAI_USER)
  --insecure     disable TLS certificate verification        (default: OPENAI_INSECURE=1)
  --from-aisp    skip step 1 — input is already AISP
  --repl         interactive session with chat context and prompt caching
                 REPL commands: /context <path> (add context mid-session), /exit
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
  ANTHROPIC_API_KEY  OPENAI_API_KEY  OPENAI_BASE_URL  OPENAI_USER  OPENAI_INSECURE
  PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP  PURIFY_MODE
  PURIFY_MODE_FILE   path to a skill markdown file (overridden by --mode-file)

Output:
  QUALITY: <tier> <name> (δ=<validator_score>, self_δ=<self_score>)
  ---
  <purified English or NEEDS_CLARIFICATION block>

Examples:
  purify -f spec.md > purified.md
  purify -f spec.md -o purified.md
  purify "add a status field with draft, active, archived"
  purify -f spec.md --verbose 2>aisp_debug.md
  purify -f spec.md --purify-model claude-haiku-4-5-20251001
  purify "add a status field" --context style-guide.md
  purify "add a status field" -c style-guide.md -c api-types.ts
  purify --repl --context style-guide.md
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
  insecure: boolean
  /** File contents when --repl and -f both set; one automatic first turn (I4). */
  initialPrimaryFromFile: string | null
  outputFile: string | null
  /** --feedback applies to the first turn only (same as batch one-shot). */
  authorContextFirstTurn: string | null
  contextFiles: ContextFile[]
}): Promise<void> {
  const {
    provider,
    mainModel,
    purifyModel,
    apiKey,
    verbose,
    mode,
    fromAisp,
    baseUrl,
    openaiUser,
    insecure,
    initialPrimaryFromFile,
    outputFile,
    authorContextFirstTurn,
  } = opts
  let contextFiles = opts.contextFiles
  const messages: ConvMessage[] = []
  let lastAssistantReply: string | null = null

  const rl = createInterface({ input: process.stdin })

  process.stderr.write(
    `purify repl — empty line to submit, /exit or ctrl-c to quit\n` +
      `provider=${provider}  purify=${purifyModel}  model=${mainModel}  mode=${mode}\n` +
      (contextFiles.length > 0
        ? `context: ${contextFiles.length} file(s): ${contextFiles.map((f) => f.path).join(", ")}\n`
        : "") +
      "\n",
  )

  process.on("SIGINT", () => {
    process.stderr.write("\nexiting...\n")
    rl.close()
    process.exit(0)
  })

  async function runOneTurn(
    input: string,
    authorContext: string | null,
  ): Promise<void> {
    try {
      let aisp = input
      if (!fromAisp) {
        process.stderr.write(`→ purifying (${purifyModel})...\n`)
        const step1User = formatPrimaryWithAuthorContext({
          primary: input,
          authorContext,
          phase: "en_to_aisp",
          contextFiles,
        })
        aisp =
          provider === "anthropic"
            ? await callLLMWithTools(apiKey, purifyModel, step1User)
            : await callLLM(
                provider,
                apiKey,
                purifyModel,
                TO_AISP_SYSTEM,
                step1User,
                {
                  baseUrl: baseUrl ?? undefined,
                  openaiUser: openaiUser ?? undefined,
                  insecure,
                },
              )
      }

      if (verbose) {
        process.stderr.write(`\n── AISP ──\n${aisp}\n──────────\n\n`)
      }

      const qualityLine = await formatReplQualityLine(aisp)
      process.stderr.write(`${qualityLine}\n`)

      const replUserContent = formatPrimaryWithAuthorContext({
        primary: aisp,
        authorContext,
        phase: "aisp_to_en",
      })
      messages.push({ role: "user", content: replUserContent })
      process.stderr.write(`→ translating (${mainModel})...\n`)
      process.stdout.write("\n")
      const systemPrompt =
        contextFiles.length > 0
          ? formatReplSystemWithContext(mode, contextFiles)
          : getReplSystem(mode)
      const response = await callLLMRepl(
        provider,
        apiKey,
        mainModel,
        systemPrompt,
        messages,
        process.stdout,
        {
          baseUrl: baseUrl ?? undefined,
          openaiUser: openaiUser ?? undefined,
          insecure,
        },
      )
      messages.push({ role: "assistant", content: response })
      lastAssistantReply = response

      process.stdout.write("\n\n")
    } catch (err) {
      logError(err)
      if (messages.at(-1)?.role === "user") messages.pop()
    }
  }

  if (initialPrimaryFromFile !== null) {
    await runOneTurn(initialPrimaryFromFile, authorContextFirstTurn)
  }

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

    if (buffer.length > 1000) {
      process.stderr.write("⊘ buffer overflow — resetting\n➤ ")
      buffer = []
      continue
    }

    const input = buffer.join("\n")
    buffer = []

    if (input.trim() === "/exit") break

    if (input.trim().startsWith("/context ")) {
      const filePath = input.trim().slice("/context ".length).trim()
      if (!filePath) {
        process.stderr.write("error: /context requires a file path\n➤ ")
        buffer = []
        continue
      }
      if (!existsSync(filePath)) {
        process.stderr.write(`error: context file not found: ${filePath}\n➤ `)
        buffer = []
        continue
      }
      let fileContent: string
      try {
        fileContent = readFileSync(filePath, "utf8")
      } catch {
        process.stderr.write(`error: cannot read context file: ${filePath}\n➤ `)
        buffer = []
        continue
      }
      contextFiles = [...contextFiles, { path: filePath, content: fileContent }]
      messages.push({
        role: "user",
        content: `FILE_CONTEXT: ${filePath}\nThis file was provided as reference context. Use it to inform interpretation and translation but do not treat it as part of the primary specification.\n\n${fileContent}`,
      })
      messages.push({
        role: "assistant",
        content: `Acknowledged. I have read ${filePath} and will use it as reference context for subsequent translations.`,
      })
      process.stderr.write(`✓ context loaded: ${filePath} (${fileContent.length} chars)\n➤ `)
      buffer = []
      continue
    }

    await runOneTurn(input, null)

    process.stderr.write("➤ ")
  }

  if (outputFile && lastAssistantReply !== null) {
    writeFileSync(outputFile, lastAssistantReply, "utf8")
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
  /** I7: only the initial purify uses --feedback. */
  feedback: string | null
  baseUrl: string | null
  openaiUser: string | null
  insecure: boolean
}): Promise<void> {
  const {
    provider,
    mainModel,
    purifyModel,
    apiKey,
    verbose,
    mode,
    fromAisp,
    inputFile,
    feedback,
    baseUrl,
    openaiUser,
    insecure,
  } = opts
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

  async function doPurify(authorContext?: string | null): Promise<string> {
    const result = await purify({
      text: currentText,
      provider,
      mainModel,
      purifyModel,
      apiKey,
      verbose,
      mode,
      fromAisp,
      authorContext: authorContext ?? undefined,
      baseUrl: baseUrl ?? undefined,
      openaiUser: openaiUser ?? undefined,
      insecure,
    })
    process.stdout.write(
      `\n── PURIFIED VERSION ──\n${result}\n── END PURIFIED ──\n\n`,
    )
    return result
  }

  // Initial purify (only first call carries --feedback)
  process.stderr.write(`→ purifying initial input...\n`)
  let purifiedResult = await doPurify(feedback)

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
        process.stderr.write(
          "⊘ no input file to save to — use --input/-f <path> for /save\n",
        )
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

      currentText = await callLLM(
        provider,
        apiKey,
        mainModel,
        APPLY_SUGGESTION_SYSTEM,
        userMsg,
        {
          baseUrl: baseUrl ?? undefined,
          openaiUser: openaiUser ?? undefined,
          insecure,
        },
      )

      process.stdout.write(
        `\n── UPDATED ORIGINAL ──\n${currentText}\n── END ORIGINAL ──\n\n`,
      )

      process.stderr.write(`→ re-purifying...\n`)
      purifiedResult = await doPurify()
    } catch (err) {
      logError(err)
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
    ensureNoInputFileAndPositionalConflict(opts.inputFile, positional)
    let initialPrimaryFromFile: string | null = null
    if (opts.inputFile) {
      try {
        initialPrimaryFromFile = readFileSync(opts.inputFile, "utf8")
      } catch {
        process.stderr.write(
          `error: cannot read --input file: ${opts.inputFile}\n`,
        )
        process.exit(1)
      }
    }
    const provider = opts.provider
    const mainModel =
      opts.model ?? process.env.PURIFY_MODEL ?? DEFAULT_MODELS[provider]
    const purifyModel =
      opts.purifyModel ??
      process.env.PURIFY_MODEL_CHEAP ??
      DEFAULT_CHEAP_MODELS[provider]
    const apiKey = resolveApiKey(provider, opts.apiKey)
    const contextFiles = loadContextFiles(opts.contextFiles)
    await runRepl({
      provider,
      mainModel,
      purifyModel,
      apiKey,
      verbose: opts.verbose,
      mode: opts.mode,
      fromAisp: opts.fromAisp,
      baseUrl: opts.baseUrl,
      openaiUser: opts.openaiUser,
      insecure: opts.insecure,
      initialPrimaryFromFile,
      outputFile: opts.outputFile,
      authorContextFirstTurn: opts.feedback,
      contextFiles,
    })
    process.exit(0)
  }

  if (opts.suggest) {
    ensureNoInputFileAndPositionalConflict(opts.inputFile, positional)
    const text = resolvePrimaryText(opts.inputFile, positional)
    if (!text?.trim()) {
      process.stderr.write(
        "error: --suggest requires -f/--input, inline text, or stdin\n",
      )
      process.exit(1)
    }
    const provider = opts.provider
    const mainModel =
      opts.model ?? process.env.PURIFY_MODEL ?? DEFAULT_MODELS[provider]
    const purifyModel =
      opts.purifyModel ??
      process.env.PURIFY_MODEL_CHEAP ??
      DEFAULT_CHEAP_MODELS[provider]
    const apiKey = resolveApiKey(provider, opts.apiKey)
    await runSuggest({
      provider,
      mainModel,
      purifyModel,
      apiKey,
      verbose: opts.verbose,
      mode: opts.mode,
      fromAisp: opts.fromAisp,
      inputFile: opts.inputFile,
      initialText: text!,
      feedback: opts.feedback,
      baseUrl: opts.baseUrl,
      openaiUser: opts.openaiUser,
      insecure: opts.insecure,
    })
    process.exit(0)
  }

  ensureNoInputFileAndPositionalConflict(opts.inputFile, positional)
  const text = resolvePrimaryText(opts.inputFile, positional)
  if (!text?.trim()) {
    printHelp()
    process.exit(0)
  }

  const provider = opts.provider
  const mainModel =
    opts.model ?? process.env.PURIFY_MODEL ?? DEFAULT_MODELS[provider]
  const purifyModel =
    opts.purifyModel ??
    process.env.PURIFY_MODEL_CHEAP ??
    DEFAULT_CHEAP_MODELS[provider]
  const apiKey = resolveApiKey(provider, opts.apiKey)

  if (opts.estimate) {
    if (provider !== "anthropic") {
      process.stderr.write(
        "error: --estimate is only supported with --provider anthropic\n",
      )
      process.exit(1)
    }
    const contextFiles = loadContextFiles(opts.contextFiles)
    const estimateUser = formatPrimaryWithAuthorContext({
      primary: text!,
      authorContext: opts.feedback,
      phase: "en_to_aisp",
      contextFiles,
    })
    const client = new Anthropic({ apiKey })
    const count = await client.messages.countTokens({
      model: purifyModel,
      system: TO_AISP_SYSTEM_WITH_TOOLS,
      messages: [{ role: "user", content: estimateUser }],
    })
    process.stdout.write(
      `Step 1 input tokens (${purifyModel}): ${count.input_tokens}\n` +
        `(Step 3 tokens depend on AISP output — run without --estimate for full output)\n`,
    )
    process.exit(0)
  }

  eprint(
    `purify: provider=${provider} purify=${purifyModel} main=${mainModel} mode=${opts.mode}`,
    opts.verbose,
  )

  const contextFiles = loadContextFiles(opts.contextFiles)
  try {
    const out = await purify({
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
      authorContext: opts.feedback,
      contextFiles,
      baseUrl: opts.baseUrl ?? undefined,
      openaiUser: opts.openaiUser ?? undefined,
      insecure: opts.insecure,
    })
    process.stdout.write("\n")
    if (opts.outputFile) {
      writeFileSync(opts.outputFile, out, "utf8")
    }
  } catch (err) {
    logError(err)
    process.exit(1)
  }
}

main()
