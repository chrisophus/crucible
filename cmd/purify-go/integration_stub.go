//go:build coverunit

// Stub implementations for unit test coverage builds.
// These replace the real LLM-dependent functions in integration.go,
// allowing unit test coverage to exclude code that requires live LLM connections.
//
// Run tests with: go test -tags coverunit -coverprofile=coverage.out ./cmd/purify-go/...

package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/types"
	"github.com/chrisophus/crucible/internal/validator"
)

func executePipeline(_ cliFlags, _ string) error {
	return errors.New("executePipeline requires live LLM connections; use integration tests")
}

func translateAndPrint(
	_ context.Context,
	result *types.PurifyRunResult,
	f cliFlags,
	_ pipeline.Deps,
) error {
	if result.Status == types.StatusHasContradictions {
		printContradictions(result.Contradictions)
		return nil
	}

	if result.Scores != nil {
		tierName := validator.TierNames[string(result.Scores.Tau)]
		fmt.Printf("QUALITY: %s %s (δ=%.2f, φ=%d)\n---\n",
			result.Scores.Tau, tierName,
			result.Scores.Delta, result.Scores.Phi)
	}

	if f.outputFile != "" {
		if err := os.WriteFile(f.outputFile, []byte("stub"), 0o600); err != nil {
			return fmt.Errorf("writing output file: %w", err)
		}
	}

	return nil
}
