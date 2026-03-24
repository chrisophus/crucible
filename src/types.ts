export type Provider = "anthropic" | "openai"
export type Mode = "formal" | "narrative" | "hybrid" | "sketch" | "summary"
export type ConvMessage = { role: "user" | "assistant"; content: string }

export interface ContextFile {
  path: string
  content: string
}

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

// ── Quality and scoring ────────────────────────────────────────────────────────

export type QualityTier = "◊⁺⁺" | "◊⁺" | "◊" | "◊⁻" | "⊘"

export interface Scores {
  delta: number
  phi: number
  tau: QualityTier
}

// ── Contradiction types ────────────────────────────────────────────────────────

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

// ── V3: Session-based pipeline types ──────────────────────────────────────────

export type ClarificationMode = "always" | "on_low_score" | "never"

export type PipelineStatus = "ready" | "needs_clarification" | "has_contradictions" | "complete"

export type GapSignal =
  | "low_delta"
  | "missing_block"
  | "sparse_rules"
  | "unresolved_type"
  | "conflicting_authority"

export interface Gap {
  location: string
  signal: GapSignal
}

export interface Config {
  clarification_mode: ClarificationMode
  score_threshold: QualityTier
  ask_on_contradiction: boolean
  max_clarify_rounds: number
}

export const DEFAULT_CONFIG: Config = {
  clarification_mode: "never",
  score_threshold: "◊",
  ask_on_contradiction: true,
  max_clarify_rounds: 2,
}

export interface Question {
  priority: "REQUIRED" | "OPTIONAL"
  question: string
}

export interface PipelineValidationResult {
  scores: Scores
  contradictions: Contradiction[]
  gaps: Gap[]
}

export interface Session {
  id: string
  systemPrompt: string
  messages: ConvMessage[]
  config: Config
  aisp_current: string | undefined
  round: number
}

export interface PurifyRunResult {
  session_id: string
  status: PipelineStatus
  questions?: Question[]
  contradictions?: Contradiction[]
  purified?: string
}

// ── Legacy types used by CLI pipeline ─────────────────────────────────────────

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

export interface TranslationResult {
  aisp: string
  purified: string | null
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
