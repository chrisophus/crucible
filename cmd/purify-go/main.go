// Command purify-go is the Go implementation of the purify CLI.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
	"github.com/chrisophus/crucible/internal/validator"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	flags := parseFlags()

	if flags.help {
		flag.Usage()
		return nil
	}

	text, err := resolveInput(flags)
	if err != nil {
		return err
	}

	return executePipeline(flags, text)
}

type cliFlags struct {
	inputFile   string
	providerStr string
	model       string
	cheapModel  string
	mode        string
	apiKey      string
	verbose     bool
	help        bool
	args        []string
}

func parseFlags() cliFlags {
	var f cliFlags

	flag.StringVar(&f.inputFile, "f", "", "input file path")
	flag.StringVar(&f.providerStr, "provider", "", "LLM provider (anthropic|openai)")
	flag.StringVar(&f.model, "model", "", "main model for AISP→English")
	flag.StringVar(&f.cheapModel, "purify-model", "", "cheap model for English→AISP")
	flag.StringVar(&f.mode, "mode", "formal", "output mode")
	flag.StringVar(&f.apiKey, "api-key", "", "API key")
	flag.BoolVar(&f.verbose, "verbose", false, "show AISP and scores on stderr")
	flag.BoolVar(&f.help, "help", false, "show help")
	flag.Parse()

	f.args = flag.Args()

	return f
}

func resolveInput(f cliFlags) (string, error) {
	if f.inputFile != "" {
		return readFile(f.inputFile)
	}

	if len(f.args) > 0 {
		return strings.Join(f.args, " "), nil
	}

	return readStdin()
}

func readFile(path string) (string, error) {
	cleaned := filepath.Clean(path)

	data, err := os.ReadFile(cleaned)
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
		return "", errors.New("no input: use -f <file>, positional args, or pipe via stdin")
	}

	data, err := os.ReadFile("/dev/stdin")
	if err != nil {
		return "", fmt.Errorf("reading stdin: %w", err)
	}

	return string(data), nil
}

func executePipeline(f cliFlags, text string) error {
	resolved, err := config.Resolve(config.LLMOpts{
		APIKey:     f.apiKey,
		Provider:   types.Provider(f.providerStr),
		Model:      f.model,
		CheapModel: f.cheapModel,
	})
	if err != nil {
		return err
	}

	deps := buildDeps(resolved)
	ctx := context.Background()

	result, err := pipeline.RunPurify(
		ctx, text, nil, types.DefaultConfig(), deps, false,
	)
	if err != nil {
		return err
	}

	printVerbose(f.verbose, result)

	return translateAndPrint(ctx, result, f.mode, deps)
}

func buildDeps(resolved config.ResolvedOpts) pipeline.Deps {
	mainLLM := newLLM(resolved.Provider, resolved.APIKey, resolved.MainModel, resolved.BaseURL)
	cheapLLM := newLLM(resolved.Provider, resolved.APIKey, resolved.CheapModel, resolved.BaseURL)

	return pipeline.Deps{
		MainLLM:  mainLLM,
		CheapLLM: cheapLLM,
		Store:    session.NewStore(),
	}
}

func newLLM(prov types.Provider, apiKey, model, baseURL string) provider.LLM {
	switch prov {
	case types.ProviderOpenAI:
		return provider.NewOpenAI(apiKey, model, baseURL)
	case types.ProviderAnthropic:
		return provider.NewAnthropic(apiKey, model)
	}

	return provider.NewAnthropic(apiKey, model)
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

func translateAndPrint(
	ctx context.Context,
	result *types.PurifyRunResult,
	mode string,
	deps pipeline.Deps,
) error {
	if result.Status == types.StatusHasContradictions {
		printContradictions(result.Contradictions)
		return nil
	}

	translated, err := pipeline.RunTranslate(
		ctx, result.SessionID, mode, deps,
	)
	if err != nil {
		return err
	}

	fmt.Println(translated.Purified)

	return nil
}

func printContradictions(contradictions []types.Contradiction) {
	fmt.Println("NEEDS_RESOLUTION")

	for i, c := range contradictions {
		fmt.Printf("%d. [%s] %s\n", i+1, c.Kind, c.Question)
	}
}
