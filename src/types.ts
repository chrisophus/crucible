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

// ── New types for purify MCP tools ────────────────────────────────────────────

export type QualityTier = "◊⁺⁺" | "◊⁺" | "◊" | "◊⁻" | "⊘"

export interface Scores {
  delta: number
  phi: number
  tau: QualityTier
}

export type ClarificationPriority = "REQUIRED" | "OPTIONAL"
export type ClarificationSource =
  | "low_delta"
  | "low_phi"
  | "contradiction"
  | "unreachable_state"
  | "conflicting_authority"

export interface Clarification {
  priority: ClarificationPriority
  question: string
  source: ClarificationSource
  field?: string
}

export type ContradictionKind =
  | "unsatisfiable_conjunction"
  | "unreachable_state"
  | "conflicting_write_authority"
  | "violated_uniqueness"

export interface Contradiction {
  kind: ContradictionKind
  statement_a: string
  statement_b: string
  proof: string
  question: string
}

export interface TranslationResult {
  aisp: string
  purified: string | null // null if contradictions present
  scores: Scores
  contradictions: Contradiction[]
  clarifications: Clarification[]
}

export interface ReflectionResult {
  interpretation: string
  assumptions: string[]
  uncertainties: string[]
}

export interface DiffEntry {
  section: string
  change: string
  preserved: string
}

export interface UpdateResult {
  purified: string
  aisp: string
  scores: Scores
  diff: DiffEntry[]
  contradictions: Contradiction[]
}
