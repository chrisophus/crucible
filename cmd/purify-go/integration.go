//go:build !coverunit

// This file contains functions that require live LLM connections.
// They are separated to allow excluding them from unit test coverage.

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/types"
	"github.com/chrisophus/crucible/internal/validator"
)

func executePipeline(f cliFlags, text string) error {
	resolved, err := config.Resolve(config.LLMOpts{
		APIKey:     f.apiKey,
		Provider:   types.Provider(f.providerStr),
		Model:      f.model,
		CheapModel: f.cheapModel,
		BaseURL:    f.baseURL,
	})
	if err != nil {
		return err
	}

	deps := buildDeps(resolved)
	ctx := context.Background()

	contextFiles, err := loadContextFiles(f.contextFiles)
	if err != nil {
		return err
	}

	cfg := types.Config{
		ContradictionDetection: resolveContradictionDetection(f),
		ExternalValidation:     resolveExternalValidation(f),
		ScoreThreshold:         types.TierSilver,
		AskOnContradiction:     false,
	}

	eprint(fmt.Sprintf("purify: provider=%s purify=%s main=%s mode=%s",
		resolved.Provider, resolved.CheapModel, resolved.MainModel, f.mode), f.verbose)

	result, err := pipeline.RunPurify(
		ctx, text, contextFiles, cfg, deps, f.fromAisp,
	)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "SESSION: %s\n", result.SessionID)

	if result.AISP != "" && f.saveAisp != "" {
		if err := os.WriteFile(f.saveAisp, []byte(result.AISP), 0o600); err != nil {
			return fmt.Errorf("writing AISP file: %w", err)
		}
		fmt.Fprintf(os.Stderr, "AISP saved to %s\n", f.saveAisp)
	}

	printVerbose(f.verbose, result)

	return translateAndPrint(ctx, result, f, deps)
}

func translateAndPrint(
	ctx context.Context,
	result *types.PurifyRunResult,
	f cliFlags,
	deps pipeline.Deps,
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

	translated, err := pipeline.RunTranslate(
		ctx, result.SessionID, f.mode, deps,
	)
	if err != nil {
		return err
	}

	fmt.Println(translated.Purified)

	if f.outputFile != "" {
		if err := os.WriteFile(f.outputFile, []byte(translated.Purified), 0o600); err != nil {
			return fmt.Errorf("writing output file: %w", err)
		}
	}

	return nil
}
