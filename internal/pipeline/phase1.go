package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

// runPhase1WithFeedback translates English to AISP, with optional author feedback.
func runPhase1WithFeedback(
	ctx context.Context,
	sess *types.Session,
	text string,
	cheapLLM provider.LLM,
	store *session.Store,
	ctxFiles []types.ContextFile,
	feedback string,
) (string, error) {
	userContent := prompt.BuildPurifyTurnContentWithFeedback(text, ctxFiles, feedback)
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
