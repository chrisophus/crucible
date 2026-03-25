package prompt_test

import (
	"strings"
	"testing"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/types"
)

func TestGetSessionSystemPrompt(t *testing.T) {
	t.Parallel()

	result := prompt.GetSessionSystemPrompt()

	if !strings.Contains(result, "AISP_SPECIFICATION") {
		t.Error("should contain AISP_SPECIFICATION header")
	}

	if !strings.Contains(result, "END_AISP_SPECIFICATION") {
		t.Error("should contain END_AISP_SPECIFICATION footer")
	}

	if !strings.Contains(result, prompt.AISPSpec) {
		t.Error("should contain the AISP spec")
	}
}

func TestBuildPurifyTurnContent(t *testing.T) {
	t.Parallel()

	t.Run("without context", func(t *testing.T) {
		t.Parallel()

		result := prompt.BuildPurifyTurnContent("test spec", nil)

		if !strings.Contains(result, "PRIMARY_SPECIFICATION") {
			t.Error("should contain PRIMARY_SPECIFICATION")
		}

		if !strings.Contains(result, "test spec") {
			t.Error("should contain the input text")
		}

		if strings.Contains(result, "CONTEXT FILES") {
			t.Error("should not contain CONTEXT FILES without context")
		}
	})

	t.Run("with context", func(t *testing.T) {
		t.Parallel()

		files := []types.ContextFile{
			{Path: "ctx.md", Content: "context content"},
		}

		result := prompt.BuildPurifyTurnContent("test spec", files)

		if !strings.Contains(result, "CONTEXT FILES") {
			t.Error("should contain CONTEXT FILES")
		}

		if !strings.Contains(result, "ctx.md") {
			t.Error("should contain context file path")
		}
	})
}

func TestBuildTranslateTurnContent(t *testing.T) {
	t.Parallel()

	t.Run("with format", func(t *testing.T) {
		t.Parallel()

		result := prompt.BuildTranslateTurnContent("narrative")

		if !strings.Contains(result, "narrative") {
			t.Error("should contain format")
		}
	})

	t.Run("empty format", func(t *testing.T) {
		t.Parallel()

		result := prompt.BuildTranslateTurnContent("")

		if strings.Contains(result, "  ") {
			t.Error("should not have double spaces with empty format")
		}
	})
}

func TestBuildUpdateTurnContent(t *testing.T) {
	t.Parallel()

	result := prompt.BuildUpdateTurnContent("add auth")

	if !strings.Contains(result, "CHANGE:\nadd auth") {
		t.Error("should contain the change description")
	}
}

func TestBuildPatchRequestContent(t *testing.T) {
	t.Parallel()

	t.Run("with hint", func(t *testing.T) {
		t.Parallel()

		result := prompt.BuildPatchRequestContent("section text", "auth module")

		if !strings.Contains(result, "HINT") {
			t.Error("should contain HINT")
		}

		if !strings.Contains(result, "auth module") {
			t.Error("should contain hint text")
		}
	})

	t.Run("without hint", func(t *testing.T) {
		t.Parallel()

		result := prompt.BuildPatchRequestContent("section text", "")

		if strings.Contains(result, "HINT") {
			t.Error("should not contain HINT without hint")
		}
	})
}

func TestBuildPatchTranslateContent(t *testing.T) {
	t.Parallel()

	result := prompt.BuildPatchTranslateContent("patch data", "narrative")

	if !strings.Contains(result, "CHANGED BLOCKS:\npatch data") {
		t.Error("should contain patch data")
	}

	if !strings.Contains(result, "narrative") {
		t.Error("should contain format")
	}
}

func TestFormatContextBlocks(t *testing.T) {
	t.Parallel()

	files := []types.ContextFile{
		{Path: "a.md", Content: "content A"},
		{Path: "b.md", Content: "content B"},
	}

	result := prompt.FormatContextBlocks(files)

	if !strings.Contains(result, "FILE_CONTEXT: a.md") {
		t.Error("should contain first file path")
	}

	if !strings.Contains(result, "FILE_CONTEXT: b.md") {
		t.Error("should contain second file path")
	}

	if !strings.Contains(result, "content A") {
		t.Error("should contain first file content")
	}
}
