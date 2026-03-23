import { getToEnglishSystem, TO_AISP_SYSTEM } from "./prompts.ts"
import { parseEvidence, runValidator, TIER_NAMES } from "./validator.ts"
import { callLLM, callLLMWithTools } from "./providers.ts"
import type { Provider, Mode } from "./types.ts"

export function eprint(msg: string, verbose: boolean): void {
  if (verbose) process.stderr.write(msg + "\n")
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
}): Promise<string> {
  const { text, provider, mainModel, purifyModel, apiKey, verbose, mode, fromAisp, thinking, stream } = opts

  let aisp: string
  if (fromAisp) {
    // Skip step 1 — input is already AISP
    aisp = text
    eprint("→ skipping purification (--from-aisp)", verbose)
  } else {
    // Step 1: English → AISP (cheap model)
    // Anthropic: use tool-use loop so the model can self-validate and revise
    eprint(`→ purifying (${purifyModel})...`, verbose)
    aisp = provider === "anthropic"
      ? await callLLMWithTools(apiKey, purifyModel, text)
      : await callLLM(provider, apiKey, purifyModel, TO_AISP_SYSTEM, text)
  }

  if (verbose) {
    process.stderr.write("\n── AISP INTERMEDIATE ──\n")
    process.stderr.write(aisp + "\n")
    process.stderr.write("────────────────────────\n\n")
  }

  // Parse self-reported evidence
  const selfReport = parseEvidence(aisp)

  // Independent validator check
  const validatorResult = await runValidator(aisp)

  // Use validator δ as authoritative if available, fall back to self-reported
  const authoritativeDelta = validatorResult?.delta ?? selfReport.delta
  const authoritativeTierSymbol = authoritativeDelta !== null
    ? (authoritativeDelta >= 0.75 ? "◊⁺⁺"
     : authoritativeDelta >= 0.60 ? "◊⁺"
     : authoritativeDelta >= 0.40 ? "◊"
     : authoritativeDelta >= 0.20 ? "◊⁻"
     : "⊘")
    : selfReport.tierSymbol
  const authoritativeTierName = TIER_NAMES[authoritativeTierSymbol] ?? "unknown"

  const deltaStr = authoritativeDelta !== null
    ? `δ=${authoritativeDelta.toFixed(2)}`
    : "δ=?"
  const selfDeltaStr = selfReport.delta !== null
    ? `, self_δ=${selfReport.delta.toFixed(2)}`
    : ""

  if (verbose && validatorResult) {
    eprint(
      `→ validator: δ=${validatorResult.delta.toFixed(3)} ` +
      `tier=${validatorResult.tier} ` +
      `ambiguity=${validatorResult.ambiguity.toFixed(3)} ` +
      `valid=${validatorResult.valid}`,
      verbose,
    )
  }
  eprint(`→ quality: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`, verbose)

  const qualityHeader = `QUALITY: ${authoritativeTierSymbol} ${authoritativeTierName} (${deltaStr}${selfDeltaStr})`

  // Step 3: AISP → English or clarifying questions (main model)
  eprint(`→ translating back (${mainModel})...`, verbose)
  if (stream) {
    process.stdout.write(qualityHeader + "\n---\n")
    const english = await callLLM(provider, apiKey, mainModel, getToEnglishSystem(mode), aisp, { streamTo: process.stdout, thinking })
    return qualityHeader + "\n---\n" + english
  }

  const english = await callLLM(provider, apiKey, mainModel, getToEnglishSystem(mode), aisp, { thinking })

  return [qualityHeader, "---", english].join("\n")
}
