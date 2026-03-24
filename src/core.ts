import {
  formatPrimaryWithAuthorContext,
  getToEnglishSystem,
  TO_AISP_SYSTEM,
} from "./prompts.ts"
import { callLLM, callLLMWithTools } from "./providers.ts"
import type { ContextFile, Mode, Provider } from "./types.ts"
import { parseEvidence, runValidator, TIER_NAMES } from "./validator.ts"

export function eprint(msg: string, verbose: boolean): void {
  if (verbose) process.stderr.write(`${msg}\n`)
}

export async function purify(opts: {
  text: string
  provider: Provider
  mainModel: string
  purifyModel: string
  apiKey: string
  verbose: boolean
  mode: Mode
  fromAisp?: boolean
  thinking?: boolean
  stream?: boolean
  baseUrl?: string
  openaiUser?: string
  insecure?: boolean
  /** Separate author channel; not spliced into primary text (labeled sections in prompts). */
  authorContext?: string | null
  contextFiles?: ContextFile[]
}): Promise<string> {
  const {
    text,
    provider,
    mainModel,
    purifyModel,
    apiKey,
    verbose,
    mode,
    fromAisp,
    thinking,
    stream,
    baseUrl,
    openaiUser,
    insecure,
    authorContext,
    contextFiles,
  } = opts

  const step1User = formatPrimaryWithAuthorContext({
    primary: text,
    authorContext,
    phase: "en_to_aisp",
    contextFiles,
  })
  const step3User = (aispDoc: string) =>
    formatPrimaryWithAuthorContext({
      primary: aispDoc,
      authorContext,
      phase: "aisp_to_en",
      contextFiles,
    })

  let aisp: string
  if (fromAisp) {
    // Skip step 1 — input is already AISP
    aisp = text
    eprint("→ skipping purification (--from-aisp)", verbose)
  } else {
    // Step 1: English → AISP (cheap model)
    // Anthropic: use tool-use loop so the model can self-validate and revise
    eprint(`→ purifying (${purifyModel})...`, verbose)
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
              baseUrl,
              openaiUser,
              insecure,
            },
          )
  }

  if (verbose) {
    process.stderr.write("\n── AISP INTERMEDIATE ──\n")
    process.stderr.write(`${aisp}\n`)
    process.stderr.write("────────────────────────\n\n")
  }

  // Parse self-reported evidence
  const selfReport = parseEvidence(aisp)

  // Independent validator check
  const validatorResult = await runValidator(aisp)

  // Use validator δ as authoritative if available, fall back to self-reported
  const authoritativeDelta = validatorResult?.delta ?? selfReport.delta
  const authoritativeTierSymbol =
    authoritativeDelta !== null
      ? authoritativeDelta >= 0.75
        ? "◊⁺⁺"
        : authoritativeDelta >= 0.6
          ? "◊⁺"
          : authoritativeDelta >= 0.4
            ? "◊"
            : authoritativeDelta >= 0.2
              ? "◊⁻"
              : "⊘"
      : selfReport.tierSymbol
  const authoritativeTierName = TIER_NAMES[authoritativeTierSymbol] ?? "unknown"

  const deltaStr =
    authoritativeDelta !== null ? `δ=${authoritativeDelta.toFixed(2)}` : "δ=?"
  const selfDeltaStr =
    selfReport.delta !== null ? `, self_δ=${selfReport.delta.toFixed(2)}` : ""

  if (verbose && validatorResult) {
    eprint(
      `→ validator: δ=${validatorResult.delta.toFixed(3)} ` +
        `tier=${validatorResult.tier} ` +
        `ambiguity=${validatorResult.ambiguity.toFixed(3)} ` +
        `valid=${validatorResult.valid}`,
      verbose,
    )
  }
  eprint(
    `→ quality: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`,
    verbose,
  )

  const qualityHeader = `QUALITY: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`

  // Step 3: AISP → English or clarifying questions (main model)
  eprint(`→ translating back (${mainModel})...`, verbose)
  const translateUser = step3User(aisp)

  if (stream) {
    process.stdout.write(`${qualityHeader}\n---\n`)
    const english = await callLLM(
      provider,
      apiKey,
      mainModel,
      getToEnglishSystem(mode),
      translateUser,
      { streamTo: process.stdout, thinking, baseUrl, openaiUser, insecure },
    )
    return `${qualityHeader}\n---\n${english}`
  }

  const english = await callLLM(
    provider,
    apiKey,
    mainModel,
    getToEnglishSystem(mode),
    translateUser,
    { thinking, baseUrl, openaiUser, insecure },
  )

  return [qualityHeader, "---", english].join("\n")
}
