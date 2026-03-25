// Package pipeline implements the 4-phase purify pipeline.
package pipeline

import (
	"context"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

// Deps holds the dependencies for pipeline execution.
type Deps struct {
	MainLLM  provider.LLM
	CheapLLM provider.LLM
	Store    *session.Store
	Feedback string // optional author context/feedback for Phase 1
}

// RunPurify executes Phases 1-3 and returns a run result.
func RunPurify(
	ctx context.Context,
	text string,
	ctxFiles []types.ContextFile,
	cfg types.Config,
	deps Deps,
	fromAISP bool,
) (*types.PurifyRunResult, error) {
	sess := deps.Store.Create(prompt.GetSessionSystemPrompt(), cfg)
	applyContextFiles(sess, ctxFiles)

	if err := runPurifyPhase1(ctx, sess, text, ctxFiles, deps, fromAISP); err != nil {
		return nil, err
	}

	return runPurifyValidation(ctx, sess, deps)
}

func applyContextFiles(sess *types.Session, files []types.ContextFile) {
	if len(files) > 0 {
		sess.ContextFiles = files
	}
}

func runPurifyPhase1(
	ctx context.Context,
	sess *types.Session,
	text string,
	ctxFiles []types.ContextFile,
	deps Deps,
	fromAISP bool,
) error {
	if fromAISP {
		seedFromAISP(sess, text, ctxFiles, deps.Store, deps.Feedback)
		return nil
	}

	files := resolveCtxFiles(ctxFiles)

	_, err := runPhase1WithFeedback(ctx, sess, text, deps.CheapLLM, deps.Store, files, deps.Feedback)

	return err
}

func resolveCtxFiles(files []types.ContextFile) []types.ContextFile {
	if len(files) > 0 {
		return files
	}

	return nil
}

func seedFromAISP(
	sess *types.Session,
	text string,
	ctxFiles []types.ContextFile,
	store *session.Store,
	feedback string,
) {
	sess.AISPCurrent = text

	files := resolveCtxFiles(ctxFiles)
	sess.Messages = append(sess.Messages,
		types.ConvMessage{
			Role:    "user",
			Content: prompt.BuildPurifyTurnContentWithFeedback(text, files, feedback),
		},
		types.ConvMessage{Role: "assistant", Content: text},
	)

	store.Save(sess)
}

func runPurifyValidation(
	ctx context.Context,
	sess *types.Session,
	deps Deps,
) (*types.PurifyRunResult, error) {
	validation, err := computeValidationResult(ctx, sess, deps.CheapLLM)
	if err != nil {
		return nil, err
	}

	if c := checkContradictions(validation, sess.Config); c != nil {
		return buildContradictionResult(sess, c, &validation.Scores), nil
	}

	return buildReadyResult(sess, &validation.Scores), nil
}

func buildContradictionResult(
	sess *types.Session,
	contradictions []types.Contradiction,
	scores *types.Scores,
) *types.PurifyRunResult {
	return &types.PurifyRunResult{
		SessionID:      sess.ID,
		Status:         types.StatusHasContradictions,
		AISP:           sess.AISPCurrent,
		Contradictions: contradictions,
		Scores:         scores,
	}
}

func buildReadyResult(
	sess *types.Session,
	scores *types.Scores,
) *types.PurifyRunResult {
	return &types.PurifyRunResult{
		SessionID: sess.ID,
		Status:    types.StatusReady,
		AISP:      sess.AISPCurrent,
		Scores:    scores,
	}
}

// RunTranslate executes Phase 4 for an existing session.
func RunTranslate(
	ctx context.Context,
	sessionID string,
	format string,
	deps Deps,
) (*types.PurifyRunResult, error) {
	sess, err := deps.Store.Get(sessionID)
	if err != nil {
		return nil, err
	}

	purified, err := runPhase4(ctx, sess, format, deps.MainLLM, deps.Store)
	if err != nil {
		return nil, err
	}

	return &types.PurifyRunResult{
		SessionID: sess.ID,
		Status:    types.StatusComplete,
		Purified:  purified,
	}, nil
}
