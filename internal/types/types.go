// Package types defines shared data structures for the purify pipeline.
package types

// Provider identifies an LLM provider.
type Provider string

// Supported LLM providers.
const (
	ProviderAnthropic Provider = "anthropic"
	ProviderOpenAI    Provider = "openai"
)

// Mode controls the output format of the translation phase.
type Mode string

// Output mode constants.
const (
	ModeFormal    Mode = "formal"
	ModeInput     Mode = "input"
	ModeNarrative Mode = "narrative"
	ModeHybrid    Mode = "hybrid"
	ModeSketch    Mode = "sketch"
	ModeSummary   Mode = "summary"
)

// QualityTier represents a quality classification.
type QualityTier string

// Quality tier constants, ordered from highest to lowest.
const (
	TierPlatinum QualityTier = "◊⁺⁺"
	TierGold     QualityTier = "◊⁺"
	TierSilver   QualityTier = "◊"
	TierBronze   QualityTier = "◊⁻"
	TierInvalid  QualityTier = "⊘"
)

// TierOrder maps quality tiers to ordinal values.
var TierOrder = map[QualityTier]int{
	TierInvalid:  0,
	TierBronze:   1,
	TierSilver:   2,
	TierGold:     3,
	TierPlatinum: 4,
}

// ConvMessage represents a conversation message.
type ConvMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ContextFile holds file content used as domain context.
type ContextFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// Evidence holds parsed quality evidence from AISP text.
type Evidence struct {
	Delta      *float64 `json:"delta"`
	TierSymbol string   `json:"tierSymbol"`
	TierName   string   `json:"tierName"`
}

// ValidatorResult holds external validator output.
type ValidatorResult struct {
	Valid       bool    `json:"valid"`
	Delta       float64 `json:"delta"`
	Tier        string  `json:"tier"`
	Ambiguity   float64 `json:"ambiguity"`
	PureDensity float64 `json:"pureDensity"`
}

// Scores holds computed quality scores.
type Scores struct {
	Delta float64     `json:"delta"`
	Phi   int         `json:"phi"`
	Tau   QualityTier `json:"tau"`
}

// ContradictionKind classifies a contradiction type.
type ContradictionKind string

// Contradiction kind constants.
const (
	KindUnsatisfiableConjunction  ContradictionKind = "unsatisfiable_conjunction"
	KindUnreachableState          ContradictionKind = "unreachable_state"
	KindConflictingWriteAuthority ContradictionKind = "conflicting_write_authority"
	KindViolatedUniqueness        ContradictionKind = "violated_uniqueness"
)

// Contradiction describes a logical conflict in the spec.
type Contradiction struct {
	Kind       ContradictionKind `json:"kind"`
	StatementA string            `json:"statement_a"`
	StatementB string            `json:"statement_b"`
	Proof      string            `json:"proof"`
	Question   string            `json:"question"`
}

// ContradictionDetection controls when to detect contradictions.
type ContradictionDetection string

// Contradiction detection mode constants.
const (
	DetectAlways     ContradictionDetection = "always"
	DetectOnLowScore ContradictionDetection = "on_low_score"
	DetectNever      ContradictionDetection = "never"
)

// ExternalValidation controls when to run the external validator.
type ExternalValidation string

// External validation mode constants.
const (
	ValidateAlways     ExternalValidation = "always"
	ValidateOnLowScore ExternalValidation = "on_low_score"
	ValidateNever      ExternalValidation = "never"
)

// PipelineStatus indicates the current state of a pipeline run.
type PipelineStatus string

// Pipeline status constants.
const (
	StatusReady             PipelineStatus = "ready"
	StatusHasContradictions PipelineStatus = "has_contradictions"
	StatusComplete          PipelineStatus = "complete"
)

// GapSignal classifies a detected gap in AISP quality.
type GapSignal string

// Gap signal constants.
const (
	GapLowDelta             GapSignal = "low_delta"
	GapMissingBlock         GapSignal = "missing_block"
	GapSparseRules          GapSignal = "sparse_rules"
	GapUnresolvedType       GapSignal = "unresolved_type"
	GapConflictingAuthority GapSignal = "conflicting_authority"
)

// Gap describes a quality gap found during validation.
type Gap struct {
	Location string    `json:"location"`
	Signal   GapSignal `json:"signal"`
}

// Config controls pipeline behavior.
type Config struct {
	ContradictionDetection ContradictionDetection `json:"contradiction_detection"`
	ExternalValidation     ExternalValidation     `json:"external_validation"`
	ScoreThreshold         QualityTier            `json:"score_threshold"`
	AskOnContradiction     bool                   `json:"ask_on_contradiction"`
}

// DefaultConfig returns the default pipeline configuration.
func DefaultConfig() Config {
	return Config{
		ContradictionDetection: DetectOnLowScore,
		ExternalValidation:     ValidateNever,
		ScoreThreshold:         TierSilver,
		AskOnContradiction:     true,
	}
}

// Session holds state for a purification session.
type Session struct {
	ID           string        `json:"id"`
	SystemPrompt string        `json:"systemPrompt"`
	Messages     []ConvMessage `json:"messages"`
	Config       Config        `json:"config"`
	AISPCurrent  string        `json:"aisp_current"`
	ContextFiles []ContextFile `json:"contextFiles,omitempty"`
}

// PurifyRunResult is the output of the purify pipeline.
type PurifyRunResult struct {
	SessionID      string          `json:"session_id"`
	Status         PipelineStatus  `json:"status"`
	Contradictions []Contradiction `json:"contradictions,omitempty"`
	Purified       string          `json:"purified,omitempty"`
	AISP           string          `json:"aisp,omitempty"`
	ContextHint    string          `json:"context_hint,omitempty"`
	Scores         *Scores         `json:"scores,omitempty"`
}

// AispBlock represents a parsed AISP block from a patch response.
type AispBlock struct {
	Name    string `json:"name"`
	Version int    `json:"version"`
	Delta   string `json:"delta"`
	Body    string `json:"body"`
}

// PatchResult is the output of the purify_patch pipeline.
type PatchResult struct {
	SessionID       string          `json:"session_id"`
	Status          PipelineStatus  `json:"status"`
	AISPPatch       []AispBlock     `json:"aisp_patch"`
	PurifiedSection string          `json:"purified_section,omitempty"`
	Contradictions  []Contradiction `json:"contradictions,omitempty"`
}

// InitResult is the output of the purify_init pipeline.
type InitResult struct {
	ContextFile string `json:"context_file"`
	Summary     string `json:"summary"`
}

// PipelineValidationResult holds validation phase output.
type PipelineValidationResult struct {
	Scores         Scores          `json:"scores"`
	Contradictions []Contradiction `json:"contradictions"`
	Gaps           []Gap           `json:"gaps"`
}
