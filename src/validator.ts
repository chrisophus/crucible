import AISP, { calculateSemanticDensity } from "aisp-validator"
import type { Evidence, ValidatorResult } from "./types.ts"

export const TIER_NAMES: Record<string, string> = {
  "◊⁺⁺": "platinum",
  "◊⁺":  "gold",
  "◊":   "silver",
  "◊⁻":  "bronze",
  "⊘":   "invalid",
}

export function parseEvidence(aisp: string): Evidence {
  const deltaMatch = aisp.match(/δ[≜=]\s*([\d.]+)/)
  const delta = deltaMatch ? parseFloat(deltaMatch[1]) : null

  const tierMatch = aisp.match(/τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)/)
  let tierSymbol = "⊘"

  if (tierMatch) {
    tierSymbol = tierMatch[1]
  } else if (delta !== null) {
    tierSymbol = delta >= 0.75 ? "◊⁺⁺"
               : delta >= 0.60 ? "◊⁺"
               : delta >= 0.40 ? "◊"
               : delta >= 0.20 ? "◊⁻"
               : "⊘"
  }

  return { delta, tierSymbol, tierName: TIER_NAMES[tierSymbol] ?? "unknown" }
}

let validatorInitialized = false

export async function runValidator(aisp: string): Promise<ValidatorResult | null> {
  try {
    if (!validatorInitialized) {
      await AISP.init()
      validatorInitialized = true
    }
    const result = AISP.validate(aisp) as { valid: boolean; tier?: string; ambiguity?: number }
    const density = calculateSemanticDensity(aisp) as { delta: number; pureDensity: number }
    return {
      valid: result.valid ?? true,
      delta: density.delta,
      tier: result.tier ?? "",
      ambiguity: result.ambiguity ?? 0,
      pureDensity: density.pureDensity ?? 0,
    }
  } catch {
    return null
  }
}
