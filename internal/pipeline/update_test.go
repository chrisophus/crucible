package pipeline_test

import (
	"context"
	"testing"

	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/types"
)

func TestRunUpdateReady(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	// First create a session via RunPurify
	run, err := pipeline.RunPurify(
		ctx, "The system shall respond.", nil,
		neverConfig(), deps, false,
	)
	if err != nil {
		t.Fatalf("RunPurify error: %v", err)
	}

	// Now update it
	result, err := pipeline.RunUpdate(
		ctx, run.SessionID, "Add retry logic", neverConfig(), deps,
	)
	if err != nil {
		t.Fatalf("RunUpdate error: %v", err)
	}

	if result.Status != types.StatusReady {
		t.Errorf("status = %q, want %q", result.Status, types.StatusReady)
	}

	if result.SessionID == "" {
		t.Error("session ID should not be empty")
	}

	// Update creates a new session
	if result.SessionID == run.SessionID {
		t.Error("update should create a new session ID")
	}
}

func TestRunUpdateExpiredSession(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	_, err := pipeline.RunUpdate(ctx, "nonexistent", "change", neverConfig(), deps)
	if err == nil {
		t.Fatal("expected error for expired session")
	}
}
