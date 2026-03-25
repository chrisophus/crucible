package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

// runPhase1 translates English to AISP using the cheap model.
func runPhase1(
	ctx context.Context,
	sess *types.Session,
	text string,
	cheapLLM provider.LLM,
	store *session.Store,
	ctxFiles []types.ContextFile,
) (string, error) {
	userContent := prompt.BuildPurifyTurnContent(text, ctxFiles)
	sess.Messages = append(sess.Messages, types.ConvMessage{
		Role:    "user",
		Content: userContent,
	})

	aisp, err := cheapLLM.CallRepl(
		ctx,
		sess.SystemPrompt,
		sess.Messages,
		provider.CallOpts{},
	)
	if err != nil {
		return "", err
	}

	cleanAISP := stripFences(aisp)

	sess.Messages = append(sess.Messages, types.ConvMessage{
		Role:    "assistant",
		Content: cleanAISP,
	})
	sess.AISPCurrent = cleanAISP
	store.Save(sess)

	return cleanAISP, nil
}
