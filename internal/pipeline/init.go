package pipeline

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

// RunInit reads project files and generates domain context for
// purify.context.md. Equivalent to purify_init in TypeScript.
func RunInit(
	ctx context.Context,
	filePaths []string,
	deps Deps,
) (*types.InitResult, error) {
	fileContents, readErrors := readProjectFiles(filePaths)

	if len(fileContents) == 0 {
		if len(readErrors) > 0 {
			return nil, fmt.Errorf("could not read any files:\n%s", strings.Join(readErrors, "\n"))
		}

		return nil, errors.New("no files provided")
	}

	userContent := buildInitUserContent(fileContents, readErrors)

	raw, err := deps.MainLLM.CallRepl(
		ctx,
		prompt.InitSystem,
		[]types.ConvMessage{
			{Role: "user", Content: userContent},
		},
		provider.CallOpts{},
	)
	if err != nil {
		return nil, err
	}

	return parseInitResult(raw, fileContents, filePaths), nil
}

func readProjectFiles(filePaths []string) ([]string, []string) {
	fileContents := make([]string, 0, len(filePaths))

	var readErrors []string

	for _, fp := range filePaths {
		cleaned := filepath.Clean(fp)

		data, err := os.ReadFile(cleaned)
		if err != nil {
			readErrors = append(readErrors, fmt.Sprintf("%s: %v", fp, err))
			continue
		}

		fileContents = append(fileContents, fmt.Sprintf("=== FILE: %s ===\n%s", fp, string(data)))
	}

	return fileContents, readErrors
}

func buildInitUserContent(fileContents, readErrors []string) string {
	userContent := strings.Join(fileContents, "\n\n")
	if len(readErrors) > 0 {
		userContent += "\n\nNote: The following files could not be read:\n" +
			strings.Join(readErrors, "\n")
	}

	return userContent
}

func parseInitResult(raw string, fileContents []string, filePaths []string) *types.InitResult {
	parsed, parseErr := parseJSON[types.InitResult](raw)
	if parseErr != nil {
		return &types.InitResult{
			ContextFile: raw,
			Summary: fmt.Sprintf("Extracted context from %d file(s): %s",
				len(fileContents), strings.Join(filePaths, ", ")),
		}
	}

	return &parsed
}
