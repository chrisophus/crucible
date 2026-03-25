package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

// computeValidationResult scores the AISP and optionally detects contradictions.
func computeValidationResult(
	ctx context.Context,
	sess *types.Session,
	cheapLLM provider.LLM,
) (types.PipelineValidationResult, error) {
	scores := computeScoresFromAISP(sess.AISPCurrent)
	gaps := computeGaps(nil, scores)

	contradictions, err := runContradictionDetection(
		ctx, sess, cheapLLM, scores,
	)
	if err != nil {
		return types.PipelineValidationResult{}, err
	}

	return types.PipelineValidationResult{
		Scores:         scores,
		Contradictions: contradictions,
		Gaps:           gaps,
	}, nil
}

func runContradictionDetection(
	ctx context.Context,
	sess *types.Session,
	cheapLLM provider.LLM,
	scores types.Scores,
) ([]types.Contradiction, error) {
	cfg := sess.Config

	switch cfg.ContradictionDetection {
	case types.DetectAlways:
		return detectContradictions(ctx, sess, cheapLLM)
	case types.DetectOnLowScore:
		if tierBelow(scores.Tau, cfg.ScoreThreshold) {
			return detectContradictions(ctx, sess, cheapLLM)
		}
	case types.DetectNever:
		// No contradiction detection
	}

	return nil, nil
}
