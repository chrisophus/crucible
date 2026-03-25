export type Provider = "anthropic" | "openai"
export type Mode =
  | "input"
  | "formal"
  | "narrative"
  | "hybrid"
  | "sketch"
  | "summary"
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

export type ContradictionDetection = "always" | "on_low_score" | "never"
export type ExternalValidation = "always" | "on_low_score" | "never"

export type PipelineStatus = "ready" | "has_contradictions" | "complete"

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
  contradiction_detection: ContradictionDetection
  external_validation: ExternalValidation
  score_threshold: QualityTier
  ask_on_contradiction: boolean
}

export const DEFAULT_CONFIG: Config = {
  contradiction_detection: "on_low_score",
  external_validation: "never",
  score_threshold: "◊",
  ask_on_contradiction: true,
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
  contextFiles?: ContextFile[]
}

export interface PurifyRunResult {
  session_id: string
  status: PipelineStatus
  contradictions?: Contradiction[]
  purified?: string
  aisp?: string
  context_hint?: string
  scores?: Scores
}

export interface AispBlock {
  name: string
  version: number
  delta: string
  body: string // includes the -- BLOCK: comment line
}

export interface PatchResult {
  session_id: string
  status: "ready" | "has_contradictions"
  aisp_patch?: AispBlock[]
  purified_section?: string
  contradictions?: Contradiction[]
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
