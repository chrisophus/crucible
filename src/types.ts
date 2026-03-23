export type Provider = "anthropic" | "openai"
export type Mode = "formal" | "narrative" | "hybrid" | "sketch" | "summary"
export type ConvMessage = { role: "user" | "assistant"; content: string }

export interface Evidence {
  delta: number | null
  tierSymbol: string
  tierName: string
}

export interface ValidatorResult {
  valid: boolean
  delta: number
  tier: string
  ambiguity: number
  pureDensity: number
}
