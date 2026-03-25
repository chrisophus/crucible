//go:build !coverunit

// This file contains functions that require live LLM connections.
// They are separated to allow excluding them from unit test coverage.

package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
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
		OpenAIUser: f.openaiUser,
		Insecure:   f.insecure,
	})
	if err != nil {
		return err
	}

	opts := llmOpts{
		OpenAIUser: resolved.OpenAIUser,
		Insecure:   resolved.Insecure,
		Thinking:   f.thinking,
	}

	modeInstr := prompt.ModeInstructions[f.mode]

	if f.estimate {
		return runEstimate(resolved, f, text)
	}

	deps := buildDeps(resolved, opts, f.feedback)

	if f.patch {
		return runPatchMode(resolved, f, text, modeInstr, deps)
	}

	if f.repl {
		return runReplMode(resolved, f, text, modeInstr, deps)
	}

	if f.suggest {
		return runSuggestMode(resolved, f, text, modeInstr, deps)
	}

	return runBatchMode(resolved, f, text, modeInstr, deps)
}

func runEstimate(resolved config.ResolvedOpts, f cliFlags, text string) error {
	if resolved.Provider != types.ProviderAnthropic {
		return errors.New("--estimate is only supported with --provider anthropic")
	}

	ap := provider.NewAnthropic(resolved.APIKey, resolved.CheapModel)

	ctxFiles, err := loadContextFiles(f.contextFiles)
	if err != nil {
		return err
	}

	userContent := prompt.BuildPurifyTurnContentWithFeedback(text, ctxFiles, f.feedback)
	systemPrompt := prompt.GetSessionSystemPrompt()

	count, err := ap.CountTokens(context.Background(), systemPrompt, userContent, resolved.CheapModel)
	if err != nil {
		return fmt.Errorf("counting tokens: %w", err)
	}

	fmt.Printf("Step 1 input tokens (%s): %d\n", resolved.CheapModel, count)
	fmt.Println("(Step 3 tokens depend on AISP output — run without --estimate for full output)")

	return nil
}

func runPatchMode(
	resolved config.ResolvedOpts,
	f cliFlags, text, modeInstr string,
	deps pipeline.Deps,
) error {
	eprint(fmt.Sprintf("purify: provider=%s purify=%s main=%s mode=%s (patch)",
		resolved.Provider, resolved.CheapModel, resolved.MainModel, f.mode), f.verbose)

	ctx := context.Background()

	result, err := pipeline.RunPatch(ctx, f.sessionID, text, f.hint, modeInstr, deps)
	if err != nil {
		return err
	}

	if result.Status == types.StatusHasContradictions {
		printContradictions(patchContradictions(result))
		return errors.New("patch has contradictions — resolve and resubmit")
	}

	fmt.Println(result.PurifiedSection)

	if f.outputFile != "" {
		if err := os.WriteFile(f.outputFile, []byte(result.PurifiedSection), 0o600); err != nil {
			return fmt.Errorf("writing output file: %w", err)
		}
	}

	return nil
}

func patchContradictions(result *types.PatchResult) []types.Contradiction {
	return result.Contradictions
}

// replState holds mutable state for the REPL loop.
type replState struct {
	prevSessionID string
	lastReply     string
	pendingCtx    []types.ContextFile
}

func runReplMode(
	resolved config.ResolvedOpts,
	f cliFlags, initialText, modeInstr string,
	deps pipeline.Deps,
) error {
	cfg := buildPipelineConfig(f)

	ctxFiles, err := loadContextFiles(f.contextFiles)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr,
		"purify repl — empty line to submit, /exit or ctrl-c to quit\n"+
			"commands: /context <path>  /patch\\n<section text>  /exit\n"+
			"provider=%s  purify=%s  model=%s  mode=%s\n\n",
		resolved.Provider, resolved.CheapModel, resolved.MainModel, f.mode)

	ctx := context.Background()
	state := &replState{pendingCtx: make([]types.ContextFile, 0)}

	handleResult := func(result *types.PurifyRunResult) error {
		return replHandleResult(ctx, result, resolved.MainModel, modeInstr, deps, state)
	}

	if initialText != "" {
		replInitialPurify(ctx, initialText, ctxFiles, cfg, deps, f.fromAisp, state, handleResult)
	}

	return replLoop(ctx, f, cfg, modeInstr, deps, ctxFiles, state, handleResult)
}

func replHandleResult(
	ctx context.Context,
	result *types.PurifyRunResult,
	mainModel, modeInstr string,
	deps pipeline.Deps,
	state *replState,
) error {
	printResultScores(result)

	fmt.Fprintf(os.Stderr, "translating (%s)...\n", mainModel)
	translated, err := pipeline.RunTranslate(ctx, result.SessionID, modeInstr, deps)
	if err != nil {
		return err
	}
	fmt.Println(translated.Purified)
	state.lastReply = translated.Purified
	state.prevSessionID = result.SessionID
	return nil
}

func replInitialPurify(
	ctx context.Context,
	text string,
	ctxFiles []types.ContextFile,
	cfg types.Config,
	deps pipeline.Deps,
	fromAisp bool,
	state *replState,
	handleResult func(*types.PurifyRunResult) error,
) {
	fmt.Fprintf(os.Stderr, "purifying...\n")
	startCtx := append(ctxFiles, state.pendingCtx...) //nolint:gocritic // intentional append to new slice
	state.pendingCtx = nil
	result, err := pipeline.RunPurify(ctx, text, startCtx, cfg, deps, fromAisp)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return
	}
	if hErr := handleResult(result); hErr != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", hErr)
	}
}

func replLoop(
	ctx context.Context,
	f cliFlags,
	cfg types.Config,
	modeInstr string,
	deps pipeline.Deps,
	ctxFiles []types.ContextFile,
	state *replState,
	handleResult func(*types.PurifyRunResult) error,
) error {
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Fprint(os.Stderr, "➤ ")

	var buffer []string
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			buffer = append(buffer, line)
			continue
		}

		input, done := drainBuffer(&buffer)
		if input == "" {
			fmt.Fprint(os.Stderr, "➤ ")
			continue
		}
		if done {
			break
		}

		if err := handleReplInput(ctx, input, f, cfg, modeInstr, deps, ctxFiles,
			state, handleResult); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
		}
		fmt.Fprint(os.Stderr, "➤ ")
	}

	if f.outputFile != "" && state.lastReply != "" {
		if err := os.WriteFile(f.outputFile, []byte(state.lastReply), 0o600); err != nil {
			return fmt.Errorf("writing output file: %w", err)
		}
	}

	fmt.Fprint(os.Stderr, "\nexiting...\n")
	return nil
}

// drainBuffer reads accumulated lines and returns the input string.
// Returns empty string if buffer was empty, or sets done=true for /exit.
func drainBuffer(buffer *[]string) (string, bool) {
	if len(*buffer) == 0 {
		return "", false
	}
	if len(*buffer) > 1000 {
		fmt.Fprint(os.Stderr, "buffer overflow — resetting\n")
		*buffer = nil
		return "", false
	}
	input := strings.Join(*buffer, "\n")
	*buffer = nil
	if strings.TrimSpace(input) == "/exit" {
		return input, true
	}
	return input, false
}

func handleReplInput(
	ctx context.Context,
	input string,
	f cliFlags,
	cfg types.Config,
	modeInstr string,
	deps pipeline.Deps,
	ctxFiles []types.ContextFile,
	state *replState,
	handleResult func(*types.PurifyRunResult) error,
) error {
	trimmed := strings.TrimSpace(input)

	if strings.HasPrefix(trimmed, "/context ") {
		return handleReplContext(trimmed, state)
	}

	if strings.HasPrefix(input, "/patch\n") || input == "/patch" {
		return handleReplPatch(ctx, input, modeInstr, deps, state)
	}

	fmt.Fprintf(os.Stderr, "purifying...\n")
	if state.prevSessionID == "" {
		startCtx := append(ctxFiles, state.pendingCtx...) //nolint:gocritic // intentional append to new slice
		state.pendingCtx = nil
		result, err := pipeline.RunPurify(ctx, input, startCtx, cfg, deps, f.fromAisp)
		if err != nil {
			return err
		}
		return handleResult(result)
	}

	result, err := pipeline.RunUpdate(ctx, state.prevSessionID, input, cfg, deps)
	if err != nil {
		return err
	}
	return handleResult(result)
}

func handleReplContext(trimmed string, state *replState) error {
	filePath := strings.TrimSpace(trimmed[len("/context "):])
	if filePath == "" {
		return errors.New("/context requires a file path")
	}
	data, err := os.ReadFile(filepath.Clean(filePath))
	if err != nil {
		return fmt.Errorf("cannot read context file: %s", filePath)
	}
	cf := types.ContextFile{Path: filePath, Content: string(data)}
	state.pendingCtx = append(state.pendingCtx, cf)
	fmt.Fprintf(os.Stderr, "context loaded: %s (%d chars)\n", filePath, len(data))
	return nil
}

func handleReplPatch(
	ctx context.Context,
	input, modeInstr string,
	deps pipeline.Deps,
	state *replState,
) error {
	if state.prevSessionID == "" {
		return errors.New("/patch requires an active session — purify something first")
	}
	section := ""
	if strings.HasPrefix(input, "/patch\n") {
		section = strings.TrimSpace(input[len("/patch\n"):])
	}
	if section == "" {
		return errors.New("usage: /patch\\n<changed section text>\\n(empty line)")
	}
	fmt.Fprintf(os.Stderr, "patching...\n")
	result, err := pipeline.RunPatch(ctx, state.prevSessionID, section, "", modeInstr, deps)
	if err != nil {
		return err
	}
	if result.Status == types.StatusHasContradictions {
		printPatchContradictions(result.Contradictions)
		return errors.New("resolve the contradictions and resubmit")
	}
	fmt.Println(result.PurifiedSection)
	state.lastReply = result.PurifiedSection
	return nil
}

func printPatchContradictions(contradictions []types.Contradiction) {
	fmt.Fprintf(os.Stderr, "\nCONTRADICTIONS FOUND\n\n")
	for i, c := range contradictions {
		fmt.Fprintf(os.Stderr, "%d. [%s]\n   %s\n   vs. %s\n   %s\n\n",
			i+1, c.Kind, c.StatementA, c.StatementB, c.Proof)
	}
}

// applySuggestionSystem is the prompt for incorporating user suggestions.
const applySuggestionSystem = `You are refining a specification document based on a user suggestion.

You will be given:
  ORIGINAL: the current source specification text
  PURIFIED: the purified (formal round-trip) version that revealed ambiguities
  SUGGESTION: the user's proposed change

Produce an updated version of the ORIGINAL text that incorporates the suggestion.

Rules:
- Modify only what is necessary to address the suggestion.
- Preserve the original's style, format, and level of detail.
- Do not introduce information not implied by the suggestion.
- Address any ambiguities the suggestion is trying to resolve.
- Output ONLY the updated original text. No preamble, no explanation.`

// suggestState holds mutable state for the suggest loop.
type suggestState struct {
	currentText    string
	purifiedResult string
}

func runSuggestMode(
	resolved config.ResolvedOpts,
	f cliFlags, initialText, modeInstr string,
	deps pipeline.Deps,
) error {
	ctx := context.Background()
	cfg := buildPipelineConfig(f)

	fmt.Fprintf(os.Stderr,
		"purify suggest — show purified version and suggest changes to the original\n"+
			"provider=%s  purify=%s  model=%s  mode=%s\n"+
			"commands: empty line to submit · /save to write file · /exit to quit\n\n",
		resolved.Provider, resolved.CheapModel, resolved.MainModel, f.mode)

	state := &suggestState{currentText: initialText}

	doPurify := func() error {
		return suggestDoPurify(ctx, cfg, modeInstr, deps, f.fromAisp, state)
	}

	fmt.Fprintf(os.Stderr, "purifying initial input...\n")
	if err := doPurify(); err != nil {
		return err
	}

	return suggestLoop(ctx, f, deps, state, doPurify)
}

func suggestDoPurify(
	ctx context.Context,
	cfg types.Config,
	modeInstr string,
	deps pipeline.Deps,
	fromAisp bool,
	state *suggestState,
) error {
	result, err := pipeline.RunPurify(ctx, state.currentText, nil, cfg, deps, fromAisp)
	if err != nil {
		return err
	}
	printPurifiedHeader(result)
	translated, err := pipeline.RunTranslate(ctx, result.SessionID, modeInstr, deps)
	if err != nil {
		return err
	}
	fmt.Println(translated.Purified)
	fmt.Printf("── END PURIFIED ──\n\n")
	state.purifiedResult = translated.Purified
	return nil
}

func printPurifiedHeader(result *types.PurifyRunResult) {
	if result.Scores != nil {
		tierName := validator.TierNames[string(result.Scores.Tau)]
		fmt.Printf("\n── PURIFIED VERSION ──\nQUALITY: %s %s (δ=%.2f, φ=%d)\n---\n",
			result.Scores.Tau, tierName, result.Scores.Delta, result.Scores.Phi)
	} else {
		fmt.Printf("\n── PURIFIED VERSION ──\n")
	}
}

func suggestLoop(
	ctx context.Context,
	f cliFlags,
	deps pipeline.Deps,
	state *suggestState,
	doPurify func() error,
) error {
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Fprint(os.Stderr, "➤ ")

	var buffer []string
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			buffer = append(buffer, line)
			continue
		}

		input, done := drainBuffer(&buffer)
		if input == "" {
			fmt.Fprint(os.Stderr, "➤ ")
			continue
		}
		input = strings.TrimSpace(input)
		if done || input == "/exit" {
			break
		}

		if input == "/save" {
			suggestSave(f.inputFile, state.currentText)
			fmt.Fprint(os.Stderr, "➤ ")
			continue
		}

		suggestApply(ctx, input, deps.MainLLM, state, doPurify)
		fmt.Fprint(os.Stderr, "➤ ")
	}

	fmt.Fprint(os.Stderr, "\nexiting...\n")
	return nil
}

func suggestSave(inputFile, currentText string) {
	if inputFile == "" {
		fmt.Fprint(os.Stderr, "no input file to save to — use --input/-f <path> for /save\n")
		return
	}
	if err := os.WriteFile(inputFile, []byte(currentText), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "error saving: %v\n", err)
		return
	}
	fmt.Fprintf(os.Stderr, "saved to %s\n", inputFile)
}

func suggestApply(
	ctx context.Context,
	input string,
	mainLLM provider.LLM,
	state *suggestState,
	doPurify func() error,
) {
	fmt.Fprintf(os.Stderr, "applying suggestion...\n")
	userMsg := fmt.Sprintf("ORIGINAL:\n%s\n\nPURIFIED:\n%s\n\nSUGGESTION:\n%s",
		state.currentText, state.purifiedResult, input)

	updated, err := mainLLM.Call(ctx, applySuggestionSystem, userMsg, provider.CallOpts{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return
	}

	state.currentText = updated
	fmt.Printf("\n── UPDATED ORIGINAL ──\n%s\n── END ORIGINAL ──\n\n", state.currentText)

	fmt.Fprintf(os.Stderr, "purifying...\n")
	if err := doPurify(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
	}
}

func buildPipelineConfig(f cliFlags) types.Config {
	return types.Config{
		ContradictionDetection: resolveContradictionDetection(f),
		ExternalValidation:     resolveExternalValidation(f),
		ScoreThreshold:         types.TierSilver,
		AskOnContradiction:     false,
	}
}

func printResultScores(result *types.PurifyRunResult) {
	if result.Scores != nil {
		tierName := validator.TierNames[string(result.Scores.Tau)]
		fmt.Fprintf(os.Stderr, "QUALITY: %s %s (δ=%.2f, φ=%d)\n",
			result.Scores.Tau, tierName, result.Scores.Delta, result.Scores.Phi)
	}
	if result.Status == types.StatusHasContradictions {
		fmt.Fprintf(os.Stderr, "\ncontradictions detected:\n")
		for i, c := range result.Contradictions {
			fmt.Fprintf(os.Stderr, "%d. [%s] %s\n", i+1, c.Kind, c.Question)
		}
	}
}

func runBatchMode(
	resolved config.ResolvedOpts,
	f cliFlags, text, modeInstr string,
	deps pipeline.Deps,
) error {
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

	return translateAndPrint(ctx, result, f, modeInstr, deps)
}

func translateAndPrint(
	ctx context.Context,
	result *types.PurifyRunResult,
	f cliFlags,
	modeInstr string,
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
		ctx, result.SessionID, modeInstr, deps,
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
