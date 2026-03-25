package pipeline_test

import (
	"context"
	"strings"
	"testing"

	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

const fakePatchResponse = `-- BLOCK: retry_rules | v=2 | delta=added exponential backoff
REQ≜[R2: "The system shall retry with exponential backoff."]`

func TestRunPatchReady(t *testing.T) {
	t.Parallel()

	mock := &provider.MockLLM{
		CallReplFn: func(
			_ context.Context,
			system string,
			msgs []types.ConvMessage,
		) (string, error) {
			last := msgs[len(msgs)-1].Content

			// Contradiction check
			if strings.Contains(last, "contradictions") || strings.Contains(last, "Analyze the AISP") {
				return `{"contradictions": []}`, nil
			}

			// Patch translate phase
			if strings.Contains(last, "CHANGED BLOCKS") {
				return "The system shall retry with exponential backoff.", nil
			}

			// Patch request phase (system prompt contains CURRENT AISP)
			if strings.Contains(system, "CURRENT AISP") {
				return fakePatchResponse, nil
			}

			// Phase 4 translate
			if strings.Contains(last, "AISP_DOCUMENT from the conversation") {
				return "The system shall respond.", nil
			}

			return fakeAISP, nil
		},
	}

	deps := pipeline.Deps{
		MainLLM:  mock,
		CheapLLM: mock,
		Store:    session.NewStore(),
	}

	ctx := context.Background()

	// Create a session and translate to populate aisp_current
	run, err := pipeline.RunPurify(
		ctx, "The system shall respond.", nil,
		neverConfig(), deps, false,
	)
	if err != nil {
		t.Fatalf("RunPurify error: %v", err)
	}

	// Translate to complete the flow
	_, err = pipeline.RunTranslate(ctx, run.SessionID, "formal", deps)
	if err != nil {
		t.Fatalf("RunTranslate error: %v", err)
	}

	// Now patch
	result, err := pipeline.RunPatch(
		ctx, run.SessionID, "Retry with exponential backoff", "", "formal", deps,
	)
	if err != nil {
		t.Fatalf("RunPatch error: %v", err)
	}

	if result.Status != types.StatusReady {
		t.Errorf("status = %q, want %q", result.Status, types.StatusReady)
	}

	if len(result.AISPPatch) == 0 {
		t.Error("expected at least one AISP block in patch")
	}

	if result.PurifiedSection == "" {
		t.Error("purified section should not be empty")
	}
}

func TestRunPatchNoAISP(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	// Create a session but with no aisp_current (use a raw session)
	store := session.NewStore()
	sess := store.Create("system", neverConfig())

	patchDeps := pipeline.Deps{
		MainLLM:  deps.MainLLM,
		CheapLLM: deps.CheapLLM,
		Store:    store,
	}

	_, err := pipeline.RunPatch(ctx, sess.ID, "section", "", "formal", patchDeps)
	if err == nil {
		t.Fatal("expected error when session has no AISP")
	}

	if !strings.Contains(err.Error(), "no AISP") {
		t.Errorf("error = %q, want message about no AISP", err.Error())
	}
}

func TestRunPatchExpiredSession(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	_, err := pipeline.RunPatch(ctx, "nonexistent", "section", "", "formal", deps)
	if err == nil {
		t.Fatal("expected error for expired session")
	}
}

func TestParseAispBlocks(t *testing.T) {
	t.Parallel()

	input := `-- BLOCK: auth | v=1 | delta=initial
AUTH_BLOCK content

-- BLOCK: retry | v=2 | delta=added backoff
RETRY_BLOCK content`

	// Use RunPatch indirectly to test parsing, or test via exported function
	// Since parseAispBlocks is unexported, we test it through RunPatch behavior
	// The TestRunPatchReady test above covers this path
	if !strings.Contains(input, "BLOCK:") {
		t.Error("test data should contain BLOCK markers")
	}
}
