package prompt

import (
	"strings"

	"github.com/chrisophus/crucible/internal/types"
)

// GetSessionSystemPrompt returns the system prompt for purify sessions.
func GetSessionSystemPrompt() string {
	return "AISP_SPECIFICATION\n\n" + AISPSpec + "\n\nEND_AISP_SPECIFICATION"
}

// FormatContextBlocks formats context files into FILE_CONTEXT blocks.
func FormatContextBlocks(files []types.ContextFile) string {
	parts := make([]string, 0, len(files))

	for _, f := range files {
		block := "FILE_CONTEXT: " + f.Path + "\n" +
			"This file is domain context — use it to inform interpretation, " +
			"translation, and clarification. " +
			"It is not the primary specification to be purified.\n\n" +
			f.Content
		parts = append(parts, block)
	}

	return strings.Join(parts, "\n\n")
}

// BuildPurifyTurnContent builds the user turn for Phase 1.
func BuildPurifyTurnContent(text string, ctxFiles []types.ContextFile) string {
	return BuildPurifyTurnContentWithFeedback(text, ctxFiles, "")
}

// BuildPurifyTurnContentWithFeedback builds the user turn for Phase 1, with
// optional author feedback/context appended.
func BuildPurifyTurnContentWithFeedback(text string, ctxFiles []types.ContextFile, feedback string) string {
	var parts []string

	if len(ctxFiles) > 0 {
		parts = append(parts, "CONTEXT FILES\n\n"+FormatContextBlocks(ctxFiles))
	}

	spec := "PRIMARY_SPECIFICATION\n\n" + text + "\n\nEND_PRIMARY_SPECIFICATION"

	if feedback != "" {
		spec += "\n\nAUTHOR_CONTEXT\n\n" + feedback + "\n\nEND_AUTHOR_CONTEXT"
	}

	spec += "\n\nTranslate the PRIMARY_SPECIFICATION block above to AISP 5.1. " +
		"Translate only that block — not any context files. " +
		"Output only the AISP document."
	parts = append(parts, spec)

	return strings.Join(parts, "\n\n---\n\n")
}

// BuildTranslateTurnContent builds the user turn for Phase 4.
func BuildTranslateTurnContent(format string) string {
	modeClause := ""
	if format != "" {
		modeClause = " " + format
	}

	return "Translate the AISP_DOCUMENT from the conversation above to English" +
		modeClause + ". Output only the translated text."
}

// BuildUpdateTurnContent builds the user turn for an update request.
func BuildUpdateTurnContent(change string) string {
	return "Update the AISP to incorporate the following change. " +
		"Output only the updated AISP document.\n\nCHANGE:\n" + change
}

// BuildPatchRequestContent builds the user turn for a patch request.
func BuildPatchRequestContent(section, hint string) string {
	hintLine := ""
	if hint != "" {
		hintLine = "\nHINT (which part of the spec this belongs to): " + hint
	}

	return "The following section of the specification has changed." + hintLine + "\n\n" +
		"Return only the AISP blocks that need to be updated. " +
		"Prefix each block with a comment line in this exact format:\n" +
		"-- BLOCK: <name> | v=<N+1> | delta=<brief description of what changed>\n\n" +
		"Where <name> is the block identifier from the existing AISP, " +
		"<N+1> increments the existing version number (use 1 if none exists), " +
		"and delta briefly describes what changed.\n\n" +
		"Output only the changed blocks, nothing else.\n\n" +
		"CHANGED SECTION:\n" + section
}

// BuildPatchTranslateContent builds the translate turn for a patch.
func BuildPatchTranslateContent(patchRaw, format string) string {
	return "Translate the following updated AISP blocks to English " + format + ". " +
		"Use the full AISP document (in the system prompt) to resolve any cross-references. " +
		"Output only the English translation of the changed blocks.\n\n" +
		"CHANGED BLOCKS:\n" + patchRaw
}
