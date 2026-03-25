package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

// contradictionResult is the JSON structure returned by the contradiction LLM.
type contradictionResult struct {
	Contradictions []types.Contradiction `json:"contradictions"`
}

// detectContradictions asks the LLM to find logical contradictions.
func detectContradictions(
	ctx context.Context,
	sess *types.Session,
	cheapLLM provider.LLM,
) ([]types.Contradiction, error) {
	msgs := make([]types.ConvMessage, 0, len(sess.Messages)+1)
	msgs = append(msgs, sess.Messages...)
	msgs = append(msgs, types.ConvMessage{
		Role: "user",
		Content: "Analyze the AISP document above for logical contradictions. " +
			prompt.ContradictionDetectionSystem,
	})

	raw, err := cheapLLM.CallRepl(
		ctx,
		sess.SystemPrompt,
		msgs,
		provider.CallOpts{},
	)
	if err != nil {
		return nil, nil //nolint:nilerr // graceful degradation
	}

	parsed, err := parseJSON[contradictionResult](raw)
	if err != nil {
		return nil, nil //nolint:nilerr // graceful degradation
	}

	return parsed.Contradictions, nil
}

// checkContradictions returns contradictions if configured to surface them.
func checkContradictions(
	validation types.PipelineValidationResult,
	cfg types.Config,
) []types.Contradiction {
	if len(validation.Contradictions) > 0 && cfg.AskOnContradiction {
		return validation.Contradictions
	}

	return nil
}
