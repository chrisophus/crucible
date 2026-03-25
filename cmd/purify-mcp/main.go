// Command purify-mcp is the Go MCP server for purify (stdio transport).
//
// Tools: purify_run, purify_translate, purify_update, purify_patch, purify_init
//
// Usage (stdio transport):
//
//	purify-mcp
//
// Environment:
//
//	ANTHROPIC_API_KEY  OPENAI_API_KEY
//	PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const serverVersion = "2.0.0"

func main() {
	if shouldShowHelp() {
		printHelp()
		os.Exit(0)
	}

	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func shouldShowHelp() bool {
	for _, arg := range os.Args[1:] {
		if arg == "--help" || arg == "-h" {
			return true
		}
	}

	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}

	return fi.Mode()&os.ModeCharDevice != 0
}

func printHelp() {
	fmt.Print(`purify-mcp — purify MCP server (stdio transport)

This command is meant to be invoked by an MCP client, not run directly.

Configure it in your MCP client:

  Claude Code (~/.claude/settings.json):
    {
      "mcpServers": {
        "purify": {
          "command": "purify-mcp",
          "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
        }
      }
    }

  Claude Desktop (~/.claude/claude_desktop_config.json):
    same format as above

Tools exposed: purify_run, purify_translate, purify_update, purify_patch, purify_init

Environment:
  ANTHROPIC_API_KEY    OPENAI_API_KEY
  PURIFY_PROVIDER      PURIFY_MODEL    PURIFY_MODEL_CHEAP
`)
}

func run() error {
	deps, err := buildDeps()
	if err != nil {
		return fmt.Errorf("initializing: %w", err)
	}

	s := server.NewMCPServer("purify", serverVersion)
	registerTools(s, deps)

	stdio := server.NewStdioServer(s)

	return stdio.Listen(context.Background(), os.Stdin, os.Stdout)
}

func buildDeps() (pipeline.Deps, error) {
	resolved, err := config.Resolve(config.LLMOpts{})
	if err != nil {
		return pipeline.Deps{}, err
	}

	return pipeline.Deps{
		MainLLM:  newLLM(resolved.Provider, resolved.APIKey, resolved.MainModel, resolved.BaseURL),
		CheapLLM: newLLM(resolved.Provider, resolved.APIKey, resolved.CheapModel, resolved.BaseURL),
		Store:    session.NewStore(),
	}, nil
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

// registerTools adds all purify tools to the MCP server.
func registerTools(s *server.MCPServer, deps pipeline.Deps) {
	s.AddTool(purifyRunTool(), handlePurifyRun(deps))
	s.AddTool(purifyTranslateTool(), handlePurifyTranslate(deps))
	s.AddTool(purifyUpdateTool(), handlePurifyUpdate(deps))
	s.AddTool(purifyPatchTool(), handlePurifyPatch(deps))
	s.AddTool(purifyInitTool(), handlePurifyInit(deps))
}

// ── Tool definitions ────────────────────────────────────────────────────────

func purifyRunTool() mcp.Tool {
	return mcp.NewTool("purify_run",
		mcp.WithDescription(
			"Step 1. Start a purify session. Translates natural language through AISP to expose ambiguity, "+
				"validates the result, and returns immediately with one of: "+
				"status=ready (call purify_translate next), "+
				"status=needs_clarification (questions returned — collect author answers and call purify_clarify), "+
				"status=has_contradictions (contradictions returned — surface to author and resolve before resubmitting). "+
				"The session accumulates conversation context for prompt caching across all subsequent calls.",
		),
		mcp.WithString("text",
			mcp.Required(),
			mcp.Description("The raw specification text to purify"),
		),
		mcp.WithString("context",
			mcp.Description("Optional domain context from purify.context.md. Injected as a context turn at the start of the session conversation."),
		),
		mcp.WithObject("config",
			mcp.Description("Optional pipeline configuration"),
		),
	)
}

func purifyTranslateTool() mcp.Tool {
	return mcp.NewTool("purify_translate",
		mcp.WithDescription(
			"Step 2. Translate the purified AISP to natural language. "+
				"Call this when purify_run returns status=ready. "+
				"Uses the full accumulated session conversation as context for faithful translation. "+
				"Returns the purified English text.",
		),
		mcp.WithString("session_id",
			mcp.Required(),
			mcp.Description("Session ID from the prior purify_run or purify_clarify call"),
		),
		mcp.WithString("format",
			mcp.Description(
				"Output format description or example. "+
					"Use \"preserve input format\" to match the original. "+
					"Can specify a mode: formal, narrative, hybrid, sketch, or summary.",
			),
			mcp.DefaultString("preserve input format"),
		),
	)
}

func purifyUpdateTool() mcp.Tool {
	return mcp.NewTool("purify_update",
		mcp.WithDescription(
			"Step 1 (update). Update an existing purified spec by applying a change. "+
				"Seeds a new session from the previous session's conversation, "+
				"appends the change as a new turn, and re-runs the full pipeline. "+
				"Returns the same status variants as purify_run — follow the same "+
				"clarify/translate flow to get the updated purified text.",
		),
		mcp.WithString("session_id",
			mcp.Required(),
			mcp.Description("Session ID from the previous completed purify session"),
		),
		mcp.WithString("change",
			mcp.Required(),
			mcp.Description("Natural language description of the change to apply"),
		),
		mcp.WithObject("config",
			mcp.Description("Optional pipeline configuration for the new session"),
		),
	)
}

func purifyPatchTool() mcp.Tool {
	return mcp.NewTool("purify_patch",
		mcp.WithDescription(
			"Patch a section of an existing purified spec without re-running the full pipeline. "+
				"Requires an existing session with aisp_current (i.e., purify_run + purify_translate already completed). "+
				"Sends only the changed section as new tokens; the full AISP is in the system prompt and is prompt-cached. "+
				"Returns a section-level English snippet and the AISP blocks that changed — not the full document. "+
				"Use this instead of purify_update when only a portion of a large spec has changed.",
		),
		mcp.WithString("session_id",
			mcp.Required(),
			mcp.Description("Session ID from a completed purify_run + purify_translate flow"),
		),
		mcp.WithString("section",
			mcp.Required(),
			mcp.Description("The changed section of the specification (English text, not a change description)"),
		),
		mcp.WithString("hint",
			mcp.Description("Optional: which part of the spec this belongs to (e.g. 'retry rules', 'auth section')"),
		),
		mcp.WithString("format",
			mcp.Description("Output format for the English snippet. Same values as purify_translate."),
			mcp.DefaultString("preserve input format"),
		),
	)
}

func purifyInitTool() mcp.Tool {
	return mcp.NewTool("purify_init",
		mcp.WithDescription(
			"Setup (once per project). Reads existing project files (specs, schemas, docs, AISP files) "+
				"and generates the content for purify.context.md — a domain model that improves all subsequent "+
				"purify sessions for this project. Pass the file path to purify_run as the context parameter. "+
				"Run this before your first purify_run for best results.",
		),
		mcp.WithArray("files",
			mcp.Required(),
			mcp.Description("Absolute or relative paths to project files to extract context from"),
		),
	)
}

// ── Handlers ────────────────────────────────────────────────────────────────

func handlePurifyRun(deps pipeline.Deps) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		text, err := request.RequireString("text")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		contextStr := request.GetString("context", "")
		cfg := resolveConfig(request)

		var ctxFiles []types.ContextFile
		if contextStr != "" {
			ctxFiles = []types.ContextFile{
				{Path: "purify.context.md", Content: contextStr},
			}
		}

		result, err := pipeline.RunPurify(ctx, text, ctxFiles, cfg, deps, false)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		if contextStr == "" {
			result.ContextHint = "No context provided. Run purify_init on your project files once to generate purify.context.md, " +
				"then pass its contents as the context parameter for higher-quality output."
		}

		return toJSONResult(result)
	}
}

func handlePurifyTranslate(deps pipeline.Deps) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := request.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		format := request.GetString("format", "preserve input format")

		result, err := pipeline.RunTranslate(ctx, sessionID, format, deps)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		return toJSONResult(result)
	}
}

func handlePurifyUpdate(deps pipeline.Deps) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := request.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		change, err := request.RequireString("change")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		cfg := resolveConfig(request)

		result, err := pipeline.RunUpdate(ctx, sessionID, change, cfg, deps)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		return toJSONResult(result)
	}
}

func handlePurifyPatch(deps pipeline.Deps) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := request.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		section, err := request.RequireString("section")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		hint := request.GetString("hint", "")
		format := request.GetString("format", "preserve input format")

		result, err := pipeline.RunPatch(ctx, sessionID, section, hint, format, deps)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		return toJSONResult(result)
	}
}

func handlePurifyInit(deps pipeline.Deps) server.ToolHandlerFunc {
	return func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := request.GetArguments()
		filesRaw, ok := args["files"]
		if !ok {
			return mcp.NewToolResultError("required argument \"files\" not found"), nil
		}

		filesSlice, ok := filesRaw.([]any)
		if !ok {
			return mcp.NewToolResultError("argument \"files\" must be an array of strings"), nil
		}

		files := make([]string, 0, len(filesSlice))
		for _, f := range filesSlice {
			s, ok := f.(string)
			if !ok {
				return mcp.NewToolResultError("argument \"files\" must be an array of strings"), nil
			}

			files = append(files, s)
		}

		result, err := pipeline.RunInit(ctx, files, deps)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		return toJSONResult(result)
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

func resolveConfig(request mcp.CallToolRequest) types.Config {
	cfg := types.DefaultConfig()

	args := request.GetArguments()

	configRaw, ok := args["config"]
	if !ok {
		return cfg
	}

	configMap, ok := configRaw.(map[string]any)
	if !ok {
		return cfg
	}

	if v, ok := configMap["score_threshold"].(string); ok {
		cfg.ScoreThreshold = types.QualityTier(v)
	}

	if v, ok := configMap["contradiction_detection"].(string); ok {
		cfg.ContradictionDetection = types.ContradictionDetection(v)
	}

	if v, ok := configMap["external_validation"].(string); ok {
		cfg.ExternalValidation = types.ExternalValidation(v)
	}

	if v, ok := configMap["ask_on_contradiction"].(bool); ok {
		cfg.AskOnContradiction = v
	}

	return cfg
}

func toJSONResult(v any) (*mcp.CallToolResult, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to marshal result: %v", err)), nil
	}

	return mcp.NewToolResultText(string(data)), nil
}
