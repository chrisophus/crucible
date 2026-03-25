package pipeline_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

const fakeAISP = `DOMAIN≜"test" φ≜95 δ≜0.80 τ≜◊⁺⁺
REQ≜[R1: "The system shall respond."]
END`

func newMockLLM() *provider.MockLLM {
	return &provider.MockLLM{
		CallReplFn: mockCallRepl,
	}
}

func mockCallRepl(
	_ context.Context,
	_ string,
	msgs []types.ConvMessage,
) (string, error) {
	last := msgs[len(msgs)-1].Content

	if strings.Contains(last, "contradictions") {
		return `{"contradictions": []}`, nil
	}

	if isTranslatePhase4(last) {
		return "The system shall respond.", nil
	}

	return fakeAISP, nil
}

func isTranslatePhase4(content string) bool {
	return strings.Contains(content, "AISP_DOCUMENT from the conversation")
}

func newDeps() pipeline.Deps {
	mock := newMockLLM()

	return pipeline.Deps{
		MainLLM:  mock,
		CheapLLM: mock,
		Store:    session.NewStore(),
	}
}

func neverConfig() types.Config {
	cfg := types.DefaultConfig()
	cfg.AskOnContradiction = false

	return cfg
}

func TestRunPurifyReady(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	result, err := pipeline.RunPurify(
		ctx, "The system should respond.", nil,
		neverConfig(), deps, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Status != types.StatusReady {
		t.Errorf("status = %q, want %q", result.Status, types.StatusReady)
	}

	if result.SessionID == "" {
		t.Error("session ID should not be empty")
	}

	if result.Scores == nil {
		t.Fatal("scores should not be nil")
	}
}

func TestRunPurifyFromAISP(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	result, err := pipeline.RunPurify(
		ctx, fakeAISP, nil, neverConfig(), deps, true,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Status != types.StatusReady {
		t.Errorf("status = %q, want %q", result.Status, types.StatusReady)
	}
}

func TestRunPurifyWithContradictions(t *testing.T) {
	t.Parallel()

	contradiction := types.Contradiction{
		Kind:       types.KindUnsatisfiableConjunction,
		StatementA: "always on",
		StatementB: "never on",
		Proof:      "both true simultaneously",
		Question:   "Which is correct?",
	}

	mock := &provider.MockLLM{
		CallReplFn: func(
			_ context.Context,
			_ string,
			msgs []types.ConvMessage,
		) (string, error) {
			last := msgs[len(msgs)-1].Content
			if strings.Contains(last, "Analyze the AISP") {
				b, _ := json.Marshal(map[string]any{
					"contradictions": []types.Contradiction{contradiction},
				})
				return string(b), nil
			}
			return fakeAISP, nil
		},
	}

	deps := pipeline.Deps{
		MainLLM:  mock,
		CheapLLM: mock,
		Store:    session.NewStore(),
	}

	cfg := types.DefaultConfig()
	cfg.AskOnContradiction = true
	cfg.ContradictionDetection = types.DetectAlways
	ctx := context.Background()

	result, err := pipeline.RunPurify(
		ctx, "The system is always on and never on.",
		nil, cfg, deps, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Status != types.StatusHasContradictions {
		t.Errorf("status = %q, want %q", result.Status, types.StatusHasContradictions)
	}

	if len(result.Contradictions) != 1 {
		t.Fatalf("got %d contradictions, want 1", len(result.Contradictions))
	}

	if result.Contradictions[0].Kind != types.KindUnsatisfiableConjunction {
		t.Errorf("kind = %q, want %q",
			result.Contradictions[0].Kind, types.KindUnsatisfiableConjunction)
	}
}

func TestRunTranslate(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	run, err := pipeline.RunPurify(
		ctx, "The system shall respond.", nil,
		neverConfig(), deps, false,
	)
	if err != nil {
		t.Fatalf("RunPurify error: %v", err)
	}

	result, err := pipeline.RunTranslate(
		ctx, run.SessionID, "narrative", deps,
	)
	if err != nil {
		t.Fatalf("RunTranslate error: %v", err)
	}

	if result.Purified == "" {
		t.Error("purified text should not be empty")
	}

	if result.SessionID != run.SessionID {
		t.Errorf("session ID = %q, want %q", result.SessionID, run.SessionID)
	}
}

func TestRunTranslateExpiredSession(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	_, err := pipeline.RunTranslate(ctx, "nonexistent", "formal", deps)
	if err == nil {
		t.Fatal("expected error for expired session")
	}
}

func TestRunPurifyWithContextFiles(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	files := []types.ContextFile{
		{Path: "context.md", Content: "domain context"},
	}

	result, err := pipeline.RunPurify(
		ctx, "spec text", files, neverConfig(), deps, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Status != types.StatusReady {
		t.Errorf("status = %q, want %q", result.Status, types.StatusReady)
	}
}

func TestRunPurifyScoresIncluded(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	result, err := pipeline.RunPurify(
		ctx, "spec", nil, neverConfig(), deps, false,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Scores == nil {
		t.Fatal("scores should be present")
	}

	if result.Scores.Delta < 0.1 {
		t.Errorf("delta = %f, expected higher", result.Scores.Delta)
	}
}
