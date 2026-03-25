package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

// runPhase4 translates AISP back to English using the main model.
func runPhase4(
	ctx context.Context,
	sess *types.Session,
	format string,
	mainLLM provider.LLM,
	store *session.Store,
) (string, error) {
	userContent := prompt.BuildTranslateTurnContent(format)
	sess.Messages = append(sess.Messages, types.ConvMessage{
		Role:    "user",
		Content: userContent,
	})

	purified, err := mainLLM.CallRepl(
		ctx,
		sess.SystemPrompt,
		sess.Messages,
		provider.CallOpts{},
	)
	if err != nil {
		return "", err
	}

	sess.Messages = append(sess.Messages, types.ConvMessage{
		Role:    "assistant",
		Content: purified,
	})
	store.Save(sess)

	return purified, nil
}
