package pipeline

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/chrisophus/crucible/internal/prompt"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

var blockHeaderRe = regexp.MustCompile(`(?m)^--\s*BLOCK:\s*([^|]+)\|\s*v=(\d+)\s*\|\s*delta=(.+)$`)

// parseAispBlocks parses `-- BLOCK: name | v=N | delta=...` markers from a
// patch LLM response.
func parseAispBlocks(raw string) []types.AispBlock {
	lines := strings.Split(raw, "\n")

	var parts []string

	current := ""

	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "-- BLOCK:") && current != "" {
			parts = append(parts, current)
			current = ""
		}

		current += line + "\n"
	}

	if current != "" {
		parts = append(parts, current)
	}

	blocks := make([]types.AispBlock, 0, len(parts))

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		m := blockHeaderRe.FindStringSubmatch(part)
		if m == nil {
			continue
		}

		ver, _ := strconv.Atoi(m[2])
		blocks = append(blocks, types.AispBlock{
			Name:    strings.TrimSpace(m[1]),
			Version: ver,
			Delta:   strings.TrimSpace(m[3]),
			Body:    part,
		})
	}

	return blocks
}

// spliceAispBlocks replaces matching blocks in the full AISP document with
// updated versions from the patch. Falls back to appending if a marker is not
// found.
func spliceAispBlocks(aisp string, blocks []types.AispBlock) string {
	result := aisp

	for _, block := range blocks {
		escaped := regexp.QuoteMeta(block.Name)
		markerRe := regexp.MustCompile(
			fmt.Sprintf(`(?m)--\s*BLOCK:\s*%s[^\n]*\n`, escaped),
		)

		loc := markerRe.FindStringIndex(result)
		if loc == nil {
			result = result + "\n\n" + block.Body
			continue
		}

		start := loc[0]
		afterMarker := loc[1]

		nextRe := regexp.MustCompile(`(?m)--\s*BLOCK:`)
		nextLoc := nextRe.FindStringIndex(result[afterMarker:])

		var end int
		if nextLoc != nil {
			end = afterMarker + nextLoc[0]
		} else {
			end = len(result)
		}

		result = result[:start] + block.Body + "\n" + result[end:]
	}

	return result
}

// RunPatch applies a section-level patch to an existing session without
// re-running the full pipeline. Equivalent to purify_patch in TypeScript.
func RunPatch(
	ctx context.Context,
	sessionID string,
	section string,
	hint string,
	format string,
	deps Deps,
) (*types.PatchResult, error) {
	sess, err := deps.Store.Get(sessionID)
	if err != nil {
		return nil, err
	}

	if sess.AISPCurrent == "" {
		return nil, errors.New("session has no AISP — call purify_run first")
	}

	blocks, patchRaw, err := generatePatch(ctx, sess, section, hint, deps)
	if err != nil {
		return nil, err
	}

	updatedAISP := spliceAispBlocks(sess.AISPCurrent, blocks)

	if result, done := checkPatchContradictions(ctx, sess, blocks, updatedAISP, deps); done {
		return result, nil
	}

	return translatePatch(ctx, sess, blocks, updatedAISP, patchRaw, format, deps)
}

func generatePatch(
	ctx context.Context,
	sess *types.Session,
	section, hint string,
	deps Deps,
) ([]types.AispBlock, string, error) {
	patchSystemPrompt := sess.SystemPrompt + "\n\n## CURRENT AISP\n\n" + sess.AISPCurrent

	patchRaw, err := deps.CheapLLM.CallRepl(
		ctx,
		patchSystemPrompt,
		[]types.ConvMessage{
			{Role: "user", Content: prompt.BuildPatchRequestContent(section, hint)},
		},
		provider.CallOpts{},
	)
	if err != nil {
		return nil, "", err
	}

	blocks := parseAispBlocks(patchRaw)
	if len(blocks) == 0 {
		return nil, "", errors.New(
			"no AISP blocks found in patch response — use purify_update for full rewrites",
		)
	}

	return blocks, patchRaw, nil
}

func checkPatchContradictions(
	ctx context.Context,
	sess *types.Session,
	blocks []types.AispBlock,
	updatedAISP string,
	deps Deps,
) (*types.PatchResult, bool) {
	patchSess := &types.Session{
		ID:           sess.ID,
		SystemPrompt: sess.SystemPrompt,
		Messages: append(
			append([]types.ConvMessage{}, sess.Messages...),
			types.ConvMessage{Role: "assistant", Content: updatedAISP},
		),
		Config:      sess.Config,
		AISPCurrent: updatedAISP,
	}

	contradictions, _ := detectContradictions(ctx, patchSess, deps.CheapLLM)

	if len(contradictions) > 0 {
		return &types.PatchResult{
			SessionID:      sess.ID,
			Status:         types.StatusHasContradictions,
			AISPPatch:      blocks,
			Contradictions: contradictions,
		}, true
	}

	return nil, false
}

func translatePatch(
	ctx context.Context,
	sess *types.Session,
	blocks []types.AispBlock,
	updatedAISP, patchRaw, format string,
	deps Deps,
) (*types.PatchResult, error) {
	translateSystemPrompt := sess.SystemPrompt + "\n\n## UPDATED AISP\n\n" + updatedAISP

	purifiedSection, err := deps.MainLLM.CallRepl(
		ctx,
		translateSystemPrompt,
		[]types.ConvMessage{
			{Role: "user", Content: prompt.BuildPatchTranslateContent(patchRaw, format)},
		},
		provider.CallOpts{},
	)
	if err != nil {
		return nil, err
	}

	sess.AISPCurrent = updatedAISP
	deps.Store.Save(sess)

	return &types.PatchResult{
		SessionID:       sess.ID,
		Status:          types.StatusReady,
		AISPPatch:       blocks,
		PurifiedSection: purifiedSection,
	}, nil
}
