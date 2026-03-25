package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

// RunUpdate seeds a new session from an existing one, applies a change, and
// re-runs the pipeline. Equivalent to purify_update in the TypeScript version.
func RunUpdate(
	ctx context.Context,
	sessionID string,
	change string,
	cfg types.Config,
	deps Deps,
) (*types.PurifyRunResult, error) {
	prev, err := deps.Store.Get(sessionID)
	if err != nil {
		return nil, err
	}

	newSess := deps.Store.Create(prev.SystemPrompt, cfg)
	newSess.Messages = make([]types.ConvMessage, len(prev.Messages))
	copy(newSess.Messages, prev.Messages)
	deps.Store.Save(newSess)

	updateContent := prompt.BuildUpdateTurnContent(change)
	newSess.Messages = append(newSess.Messages, types.ConvMessage{
		Role:    "user",
		Content: updateContent,
	})

	updatedAISP, err := deps.CheapLLM.CallRepl(
		ctx,
		newSess.SystemPrompt,
		newSess.Messages,
		provider.CallOpts{},
	)
	if err != nil {
		return nil, err
	}

	cleanAISP := stripFences(updatedAISP)
	newSess.Messages = append(newSess.Messages, types.ConvMessage{
		Role:    "assistant",
		Content: cleanAISP,
	})
	newSess.AISPCurrent = cleanAISP
	deps.Store.Save(newSess)

	return runPurifyValidation(ctx, newSess, deps)
}
