// Command purify-go is the Go implementation of the purify CLI.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
	"github.com/chrisophus/crucible/internal/validator"
	"github.com/spf13/cobra"
)

// version is set at build time via -ldflags.
var version = "1.0.0"

// cliFlags holds all parsed CLI options.
type cliFlags struct {
	inputFile        string
	outputFile       string
	saveAisp         string
	providerStr      string
	model            string
	cheapModel       string
	apiKey           string
	baseURL          string
	openaiUser       string
	insecure         bool
	mode             string
	modeFile         string
	verbose          bool
	debug            bool
	veryVerbose      bool
	contradictions   bool
	noContradictions bool
	validate         bool
	noValidate       bool
	fromAisp         bool
	repl             bool
	suggest          bool
	thinking         bool
	estimate         bool
	patch            bool
	sessionID        string
	hint             string
	feedback         string
	contextFiles     []string
	formal           bool
	narrative        bool
	hybrid           bool
	sketch           bool
	summary          bool
}

func main() {
	if err := newRootCmd().Execute(); err != nil {
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	var f cliFlags

	cmd := &cobra.Command{
		Use:   "purify-go [options] [text...]",
		Short: "AISP round-trip spec purification",
		Long: `purify-go — AISP round-trip spec purification

Usage:
  purify-go [options] -f <path> | "inline text" | stdin
  purify-go -f spec.md
  purify-go "inline text"
  cat spec.md | purify-go [options]

Positional arguments are always treated as literal text (not file paths).
Use -f / --input for file input. Do not combine -f with positional text.`,
		Example: `  purify-go -f spec.md
  purify-go -f spec.md -o purified.md
  purify-go "add a status field with draft, active, archived"
  purify-go -f spec.md --suggest
  purify-go --repl -c style-guide.md
  purify-go -f spec.md --feedback "focus on the auth section"
  purify-go -f spec.md --verbose 2>aisp_debug.md
  purify-go -f spec.md --debug 2>llm_trace.log
  purify-go -f spec.md --very-verbose 2>full_trace.log
  purify-go "add a status field" -c style-guide.md -c api-types.ts

Patch workflow (large specs):
  SESSION=$(purify-go -f spec.md 2>&1 >/dev/null | grep SESSION | cut -d' ' -f2)
  purify-go --patch -f changed-section.md --session $SESSION
  purify-go --patch "retry up to 5 times" --session $SESSION --hint "retry rules"`,
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			f.resolveShorthandModes()
			if err := f.resolveModeFile(cmd); err != nil {
				return err
			}
			if f.veryVerbose {
				f.debug = true
			}
			return run(f, args)
		},
	}

	registerFlags(cmd, &f)

	return cmd
}

func registerFlags(cmd *cobra.Command, f *cliFlags) {
	// Input/Output flags
	cmd.Flags().StringVarP(&f.inputFile, "input", "f", "", "read primary specification from this file path")
	cmd.Flags().StringVarP(&f.outputFile, "output", "o", "", "write final English to this path")
	cmd.Flags().StringVar(&f.saveAisp, "save-aisp", "", "write the generated AISP document to this path")
	cmd.Flags().StringSliceVarP(&f.contextFiles, "context", "c", nil, "add a file as reference context (repeatable)")
	cmd.Flags().StringVar(&f.feedback, "feedback", "", "author context for one-shot clarifications/extra context")

	// LLM configuration
	cmd.Flags().StringVar(&f.providerStr, "provider", "", "LLM provider (anthropic|openai)")
	cmd.Flags().StringVar(&f.model, "model", "", "main model for AISP→English")
	cmd.Flags().StringVar(&f.cheapModel, "purify-model", "", "cheap model for English→AISP")
	cmd.Flags().StringVar(&f.apiKey, "api-key", "", "API key")
	cmd.Flags().StringVar(&f.baseURL, "base-url", "", "OpenAI-compatible base URL")
	cmd.Flags().StringVar(&f.openaiUser, "user", "", "OpenAI user identifier for tracking")
	cmd.Flags().BoolVar(&f.insecure, "insecure", false, "disable TLS certificate verification")

	// Mode flags
	cmd.Flags().StringVar(&f.mode, "mode", "formal", "output mode (formal|input|narrative|hybrid|sketch|summary)")
	cmd.Flags().StringVar(&f.modeFile, "mode-file", "", "path to a skill markdown file that specifies the mode")
	cmd.Flags().BoolVar(&f.formal, "formal", false, "shorthand for --mode formal")
	cmd.Flags().BoolVar(&f.narrative, "narrative", false, "shorthand for --mode narrative")
	cmd.Flags().BoolVar(&f.hybrid, "hybrid", false, "shorthand for --mode hybrid")
	cmd.Flags().BoolVar(&f.sketch, "sketch", false, "shorthand for --mode sketch")
	cmd.Flags().BoolVar(&f.summary, "summary", false, "shorthand for --mode summary")

	// Processing modes
	cmd.Flags().BoolVar(&f.fromAisp, "from-aisp", false, "skip step 1 — input is already AISP")
	cmd.Flags().BoolVar(&f.thinking, "thinking", false, "enable extended thinking for Step 3 (Anthropic Sonnet/Opus only)")
	cmd.Flags().BoolVar(&f.estimate, "estimate", false, "count input tokens for Step 1 and exit (Anthropic only)")
	cmd.Flags().BoolVar(&f.repl, "repl", false, "interactive session with chat context and prompt caching")
	cmd.Flags().BoolVar(&f.suggest, "suggest", false, "show purified version then suggest changes applied to the original")

	// Patch flags
	cmd.Flags().BoolVar(&f.patch, "patch", false, "patch a section of an existing session (requires --session)")
	cmd.Flags().StringVar(&f.sessionID, "session", "", "session ID to patch")
	cmd.Flags().StringVar(&f.hint, "hint", "", "optional hint for --patch: which part of the spec the section belongs to")

	// Contradiction & validation control
	cmd.Flags().BoolVar(&f.contradictions, "contradictions", false, "always run LLM contradiction detection")
	cmd.Flags().BoolVar(&f.noContradictions, "no-contradictions", false, "skip contradiction detection entirely")
	cmd.Flags().BoolVar(&f.validate, "validate", false, "always run external WASM validator")
	cmd.Flags().BoolVar(&f.noValidate, "no-validate", false, "skip external validator entirely")

	// Debugging & verbosity
	cmd.Flags().BoolVar(&f.verbose, "verbose", false, "write AISP and scores to stderr")
	cmd.Flags().BoolVar(&f.debug, "debug", false, "log every LLM request and response to stderr")
	cmd.Flags().BoolVar(&f.veryVerbose, "very-verbose", false, "log full request/response content (implies --debug)")
}

// resolveShorthandModes applies shorthand mode flags (--formal, --narrative, etc.)
func (f *cliFlags) resolveShorthandModes() {
	switch {
	case f.formal:
		f.mode = "formal"
	case f.narrative:
		f.mode = "narrative"
	case f.hybrid:
		f.mode = "hybrid"
	case f.sketch:
		f.mode = "sketch"
	case f.summary:
		f.mode = "summary"
	}
}

var validModes = map[string]bool{
	"formal": true, "input": true, "narrative": true,
	"hybrid": true, "sketch": true, "summary": true,
}

// resolveModeFile reads a skill markdown file if --mode-file is set and no explicit
// mode flag was provided.
func (f *cliFlags) resolveModeFile(cmd *cobra.Command) error {
	// If mode-file is not set, check environment
	if f.modeFile == "" {
		f.modeFile = os.Getenv("PURIFY_MODE_FILE")
	}
	if f.modeFile == "" {
		return nil
	}

	// If any explicit mode flag was set, skip mode file
	modeChanged := cmd.Flags().Changed("mode") || cmd.Flags().Changed("formal") ||
		cmd.Flags().Changed("narrative") || cmd.Flags().Changed("hybrid") ||
		cmd.Flags().Changed("sketch") || cmd.Flags().Changed("summary")
	if modeChanged {
		return nil
	}

	mode, err := parseModeFile(f.modeFile)
	if err != nil {
		return err
	}
	f.mode = mode
	return nil
}

// parseModeFile extracts the mode from a skill markdown file's YAML frontmatter
// or ## Mode section.
func parseModeFile(filePath string) (string, error) {
	data, err := os.ReadFile(filepath.Clean(filePath))
	if err != nil {
		return "", fmt.Errorf("mode file not found: %s", filePath)
	}
	content := string(data)

	// Try YAML frontmatter: mode: <value> between --- delimiters
	fmRe := regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---`)
	if fmMatch := fmRe.FindStringSubmatch(content); fmMatch != nil {
		modeRe := regexp.MustCompile(`(?m)^mode:\s*(\S+)`)
		if modeMatch := modeRe.FindStringSubmatch(fmMatch[1]); modeMatch != nil {
			mode := strings.ToLower(modeMatch[1])
			if !validModes[mode] {
				return "", fmt.Errorf("invalid mode %q in %s; valid modes: formal, input, narrative, hybrid, sketch, summary", mode, filePath)
			}
			return mode, nil
		}
	}

	// Fall back to ## Mode section
	secRe := regexp.MustCompile(`(?m)^##\s+Mode\s*\r?\n([\s\S]*?)(?:^##|\z)`)
	if secMatch := secRe.FindStringSubmatch(content); secMatch != nil {
		for _, line := range strings.Split(secMatch[1], "\n") {
			trimmed := strings.TrimSpace(strings.ToLower(line))
			if trimmed != "" && validModes[trimmed] {
				return trimmed, nil
			}
		}
	}

	return "", fmt.Errorf("no valid mode found in %s; add \"mode: <value>\" to frontmatter or a \"## Mode\" section", filePath)
}

// resolveEnvDefaults fills in flag values from environment variables when not set explicitly.
func (f *cliFlags) resolveEnvDefaults() {
	if f.providerStr == "" {
		f.providerStr = os.Getenv("PURIFY_PROVIDER")
	}
	if f.mode == "formal" && os.Getenv("PURIFY_MODE") != "" {
		f.mode = os.Getenv("PURIFY_MODE")
	}
	if f.baseURL == "" {
		f.baseURL = os.Getenv("OPENAI_BASE_URL")
	}
	if f.openaiUser == "" {
		f.openaiUser = os.Getenv("OPENAI_USER")
	}
	if !f.insecure && os.Getenv("OPENAI_INSECURE") == "1" {
		f.insecure = true
	}
}

func run(f cliFlags, args []string) error {
	f.resolveEnvDefaults()

	if f.inputFile != "" && len(args) > 0 {
		return errors.New("use either --input/-f <path> or inline positional text, not both")
	}

	text, err := resolveInput(f.inputFile, args)
	if err != nil {
		return err
	}

	if f.patch {
		if text == "" {
			return errors.New("--patch requires -f/--input, inline text, or stdin")
		}
		if f.sessionID == "" {
			return errors.New("--patch requires --session <session_id>")
		}
	}

	if text == "" {
		return nil
	}

	return executePipeline(f, text)
}

func resolveInput(inputFile string, args []string) (string, error) {
	if inputFile != "" {
		return readFile(inputFile)
	}

	if len(args) > 0 {
		return strings.Join(args, " "), nil
	}

	return readStdin()
}

func readFile(path string) (string, error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return "", fmt.Errorf("reading input file: %w", err)
	}

	return string(data), nil
}

func readStdin() (string, error) {
	info, err := os.Stdin.Stat()
	if err != nil {
		return "", fmt.Errorf("checking stdin: %w", err)
	}

	if info.Mode()&os.ModeNamedPipe == 0 {
		return "", nil
	}

	data, err := os.ReadFile("/dev/stdin")
	if err != nil {
		return "", fmt.Errorf("reading stdin: %w", err)
	}

	return string(data), nil
}

func resolveContradictionDetection(f cliFlags) types.ContradictionDetection {
	if f.contradictions {
		return types.DetectAlways
	}
	if f.noContradictions {
		return types.DetectNever
	}
	return types.DetectOnLowScore
}

func resolveExternalValidation(f cliFlags) types.ExternalValidation {
	if f.validate {
		return types.ValidateAlways
	}
	if f.noValidate {
		return types.ValidateNever
	}
	return types.ValidateNever
}

func loadContextFiles(paths []string) ([]types.ContextFile, error) {
	files := make([]types.ContextFile, 0, len(paths))
	for _, p := range paths {
		data, err := os.ReadFile(filepath.Clean(p))
		if err != nil {
			return nil, fmt.Errorf("cannot read context file: %s", p)
		}
		files = append(files, types.ContextFile{Path: p, Content: string(data)})
	}
	return files, nil
}

// llmOpts holds options for constructing LLM providers.
type llmOpts struct {
	OpenAIUser string
	Insecure   bool
	Thinking   bool
}

func buildDeps(resolved config.ResolvedOpts, opts llmOpts, feedback string) pipeline.Deps {
	mainOpts := opts
	cheapOpts := opts
	// Thinking only applies to the main model (Phase 4 translation)
	cheapOpts.Thinking = false

	mainLLM := newLLM(resolved.Provider, resolved.APIKey, resolved.MainModel, resolved.BaseURL, mainOpts)
	cheapLLM := newLLM(resolved.Provider, resolved.APIKey, resolved.CheapModel, resolved.BaseURL, cheapOpts)

	return pipeline.Deps{
		MainLLM:  mainLLM,
		CheapLLM: cheapLLM,
		Store:    session.NewStore(),
		Feedback: feedback,
	}
}

func newLLM(prov types.Provider, apiKey, model, baseURL string, opts llmOpts) provider.LLM {
	switch prov {
	case types.ProviderOpenAI:
		return provider.NewOpenAIWithOpts(apiKey, model, baseURL, provider.OpenAIOpts{
			User:     opts.OpenAIUser,
			Insecure: opts.Insecure,
		})
	case types.ProviderAnthropic:
		return provider.NewAnthropicWithOpts(apiKey, model, provider.AnthropicOpts{
			Thinking: opts.Thinking,
		})
	}

	return provider.NewAnthropicWithOpts(apiKey, model, provider.AnthropicOpts{
		Thinking: opts.Thinking,
	})
}

func eprint(msg string, verbose bool) {
	if verbose {
		fmt.Fprintf(os.Stderr, "%s\n", msg)
	}
}

func printVerbose(verbose bool, result *types.PurifyRunResult) {
	if !verbose || result.Scores == nil {
		return
	}

	tierName := validator.TierNames[string(result.Scores.Tau)]

	fmt.Fprintf(os.Stderr, "QUALITY: %s %s (δ=%.2f, φ=%d)\n",
		result.Scores.Tau, tierName,
		result.Scores.Delta, result.Scores.Phi)

	if result.AISP != "" {
		fmt.Fprintf(os.Stderr, "---\n%s\n---\n", result.AISP)
	}
}

func printContradictions(contradictions []types.Contradiction) {
	fmt.Println("NEEDS_RESOLUTION")

	for i, c := range contradictions {
		fmt.Printf("%d. [%s] %s\n", i+1, c.Kind, c.Question)
	}
}

// scanLines reads multiline input from stdin, returning on empty line or EOF.
func scanLines(scanner *bufio.Scanner) string {
	var lines []string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			break
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}
