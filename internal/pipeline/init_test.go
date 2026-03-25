package pipeline_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
)

func TestRunInit(t *testing.T) {
	t.Parallel()

	tmpDir := t.TempDir()
	specFile := filepath.Join(tmpDir, "spec.md")

	if err := os.WriteFile(specFile, []byte("# My Spec\nThe system does things."), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	mock := &provider.MockLLM{
		CallReplFn: func(
			_ context.Context,
			_ string,
			_ []types.ConvMessage,
		) (string, error) {
			return `{"context_file": "# Domain Context\nEntities: System", "summary": "Extracted from 1 file"}`, nil
		},
	}

	deps := pipeline.Deps{
		MainLLM:  mock,
		CheapLLM: mock,
		Store:    session.NewStore(),
	}

	ctx := context.Background()

	result, err := pipeline.RunInit(ctx, []string{specFile}, deps)
	if err != nil {
		t.Fatalf("RunInit error: %v", err)
	}

	if result.ContextFile == "" {
		t.Error("context file should not be empty")
	}

	if result.Summary == "" {
		t.Error("summary should not be empty")
	}
}

func TestRunInitNoFiles(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	_, err := pipeline.RunInit(ctx, nil, deps)
	if err == nil {
		t.Fatal("expected error with no files")
	}

	if !strings.Contains(err.Error(), "no files") {
		t.Errorf("error = %q, want message about no files", err.Error())
	}
}

func TestRunInitBadFile(t *testing.T) {
	t.Parallel()

	// LLM returns non-JSON so we test fallback path
	mock := &provider.MockLLM{
		CallReplFn: func(
			_ context.Context,
			_ string,
			_ []types.ConvMessage,
		) (string, error) {
			return "plain text context", nil
		},
	}

	deps := pipeline.Deps{
		MainLLM:  mock,
		CheapLLM: mock,
		Store:    session.NewStore(),
	}

	tmpDir := t.TempDir()
	specFile := filepath.Join(tmpDir, "spec.md")
	if err := os.WriteFile(specFile, []byte("content"), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	ctx := context.Background()
	result, err := pipeline.RunInit(ctx, []string{specFile}, deps)
	if err != nil {
		t.Fatalf("RunInit error: %v", err)
	}

	// Fallback: raw LLM output as context_file
	if result.ContextFile != "plain text context" {
		t.Errorf("context_file = %q, want raw LLM output", result.ContextFile)
	}
}

func TestRunInitAllFilesFail(t *testing.T) {
	t.Parallel()

	deps := newDeps()
	ctx := context.Background()

	_, err := pipeline.RunInit(ctx, []string{"/nonexistent/file.md"}, deps)
	if err == nil {
		t.Fatal("expected error when all files fail to read")
	}

	if !strings.Contains(err.Error(), "could not read") {
		t.Errorf("error = %q, want message about unreadable files", err.Error())
	}
}
