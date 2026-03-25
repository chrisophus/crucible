package pipeline

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/chrisophus/crucible/internal/types"
	"github.com/chrisophus/crucible/internal/validator"
)

var fenceRe = regexp.MustCompile("(?m)^```[^\n]*\n([\\s\\S]*?)```")

// stripFences removes markdown code fences from LLM output.
func stripFences(raw string) string {
	result := fenceRe.ReplaceAllString(raw, "$1")

	return strings.TrimSpace(result)
}

// tierBelow returns true if tier a is strictly below tier b.
func tierBelow(a, b types.QualityTier) bool {
	return types.TierOrder[a] < types.TierOrder[b]
}

// parseJSON extracts JSON from text, stripping optional fences.
func parseJSON[T any](text string) (T, error) {
	var result T

	stripped := strings.TrimSpace(text)

	re := regexp.MustCompile("(?s)^```(?:json)?\\s*\n(.+?)\n```\\s*$")
	if m := re.FindStringSubmatch(stripped); m != nil {
		stripped = m[1]
	}

	err := json.Unmarshal([]byte(stripped), &result)

	return result, err
}

// computeGaps identifies quality gaps from validation results.
func computeGaps(
	validatorResult *types.ValidatorResult,
	scores types.Scores,
) []types.Gap {
	var gaps []types.Gap

	if scores.Delta < 0.4 {
		gaps = append(gaps, types.Gap{
			Location: "overall",
			Signal:   types.GapLowDelta,
		})
	}

	if validatorResult != nil && !validatorResult.Valid {
		gaps = append(gaps, types.Gap{
			Location: "document_structure",
			Signal:   types.GapMissingBlock,
		})
	}

	return gaps
}

// computeScoresFromAISP computes scores from AISP text.
func computeScoresFromAISP(aisp string) types.Scores {
	ev := validator.ParseEvidence(aisp)
	phi := validator.ParsePhi(aisp)

	delta := 0.0
	if ev.Delta != nil {
		delta = *ev.Delta
	}

	tau := validator.ComputeTier(delta, phi)

	return types.Scores{Delta: delta, Phi: phi, Tau: tau}
}
