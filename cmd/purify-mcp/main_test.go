package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/chrisophus/crucible/internal/pipeline"
	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/session"
	"github.com/chrisophus/crucible/internal/types"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const testAISP = `DOMAIN≜"test" φ≜95 δ≜0.80 τ≜◊⁺⁺
-- BLOCK: main | v=1 | delta=initial
REQ≜[R1: "The system shall respond."]
END`

func mockDeps() pipeline.Deps {
	mock := &provider.MockLLM{
		CallReplFn: func(
			_ context.Context,
			system string,
			msgs []types.ConvMessage,
		) (string, error) {
			last := msgs[len(msgs)-1].Content

			if strings.Contains(last, "contradictions") || strings.Contains(last, "Analyze the AISP") {
				return `{"contradictions": []}`, nil
			}

			if strings.Contains(last, "AISP_DOCUMENT from the conversation") {
				return "The system shall respond.", nil
			}

			if strings.Contains(last, "CHANGED BLOCKS") {
				return "Updated section text.", nil
			}

			if strings.Contains(system, "CURRENT AISP") {
				return "-- BLOCK: main | v=2 | delta=updated\nREQ≜[R1: \"Updated.\"]", nil
			}

			if strings.Contains(system, "Extract domain context") {
				return `{"context_file": "# Context", "summary": "test"}`, nil
			}

			return testAISP, nil
		},
	}

	return pipeline.Deps{
		MainLLM:  mock,
		CheapLLM: mock,
		Store:    session.NewStore(),
	}
}

func newTestServer(deps pipeline.Deps) *server.MCPServer {
	s := server.NewMCPServer("purify", serverVersion)
	registerTools(s, deps)
	return s
}

// callTool sends a tools/call JSON-RPC message and returns the parsed CallToolResult.
func callTool(t *testing.T, s *server.MCPServer, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()

	argsJSON, err := json.Marshal(args)
	if err != nil {
		t.Fatalf("marshal args: %v", err)
	}

	msg := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`,
		name, string(argsJSON))

	resp := s.HandleMessage(context.Background(), json.RawMessage(msg))

	respJSON, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}

	var rpcResp struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.Unmarshal(respJSON, &rpcResp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if rpcResp.Error != nil {
		t.Fatalf("RPC error: %s", rpcResp.Error.Message)
	}

	var callResult mcp.CallToolResult
	if err := json.Unmarshal(rpcResp.Result, &callResult); err != nil {
		t.Fatalf("unmarshal CallToolResult: %v", err)
	}

	return &callResult
}

func extractSessionID(t *testing.T, result *mcp.CallToolResult) string {
	t.Helper()

	if len(result.Content) == 0 {
		t.Fatal("no content in result")
	}

	textContent, ok := result.Content[0].(mcp.TextContent)
	if !ok {
		// Try marshalling back
		b, _ := json.Marshal(result.Content[0])
		var tc mcp.TextContent
		if err := json.Unmarshal(b, &tc); err != nil {
			t.Fatalf("expected TextContent, got %T", result.Content[0])
		}
		textContent = tc
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(textContent.Text), &data); err != nil {
		t.Fatalf("unmarshal result JSON: %v", err)
	}

	id, ok := data["session_id"].(string)
	if !ok || id == "" {
		t.Fatal("session_id not found in result")
	}

	return id
}

func TestPurifyRunTool(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	result := callTool(t, s, "purify_run", map[string]any{
		"text": "The system shall respond.",
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}

	if len(result.Content) == 0 {
		t.Fatal("expected content in result")
	}
}

func TestPurifyTranslateTool(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	runResult := callTool(t, s, "purify_run", map[string]any{
		"text": "The system shall respond.",
	})
	sessionID := extractSessionID(t, runResult)

	result := callTool(t, s, "purify_translate", map[string]any{
		"session_id": sessionID,
		"format":     "formal",
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}
}

func TestPurifyUpdateTool(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	runResult := callTool(t, s, "purify_run", map[string]any{
		"text": "The system shall respond.",
	})
	sessionID := extractSessionID(t, runResult)

	result := callTool(t, s, "purify_update", map[string]any{
		"session_id": sessionID,
		"change":     "Add retry logic",
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}
}

func TestPurifyPatchTool(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	runResult := callTool(t, s, "purify_run", map[string]any{
		"text": "The system shall respond.",
	})
	sessionID := extractSessionID(t, runResult)

	callTool(t, s, "purify_translate", map[string]any{
		"session_id": sessionID,
		"format":     "formal",
	})

	result := callTool(t, s, "purify_patch", map[string]any{
		"session_id": sessionID,
		"section":    "Updated retry section",
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}
}

func TestPurifyRunWithConfig(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	result := callTool(t, s, "purify_run", map[string]any{
		"text": "spec text",
		"config": map[string]any{
			"contradiction_detection": "never",
			"score_threshold":         "◊⁺",
			"ask_on_contradiction":    false,
		},
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}
}

func TestPurifyRunMissingText(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	result := callTool(t, s, "purify_run", map[string]any{})

	if !result.IsError {
		t.Fatal("expected error for missing text")
	}
}

func TestResolveConfigDefaults(t *testing.T) {
	t.Parallel()

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{}

	cfg := resolveConfig(req)

	if cfg.ContradictionDetection != types.DetectOnLowScore {
		t.Errorf("contradiction_detection = %q, want %q",
			cfg.ContradictionDetection, types.DetectOnLowScore)
	}

	if cfg.ScoreThreshold != types.TierSilver {
		t.Errorf("score_threshold = %q, want %q",
			cfg.ScoreThreshold, types.TierSilver)
	}
}

func TestResolveConfigOverrides(t *testing.T) {
	t.Parallel()

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{
		"config": map[string]any{
			"contradiction_detection": "always",
			"score_threshold":         "◊⁺⁺",
			"ask_on_contradiction":    false,
			"external_validation":     "always",
		},
	}

	cfg := resolveConfig(req)

	if cfg.ContradictionDetection != types.DetectAlways {
		t.Errorf("contradiction_detection = %q, want %q",
			cfg.ContradictionDetection, types.DetectAlways)
	}

	if cfg.ScoreThreshold != types.TierPlatinum {
		t.Errorf("score_threshold = %q, want %q",
			cfg.ScoreThreshold, types.TierPlatinum)
	}

	if cfg.AskOnContradiction {
		t.Error("ask_on_contradiction should be false")
	}

	if cfg.ExternalValidation != types.ValidateAlways {
		t.Errorf("external_validation = %q, want %q",
			cfg.ExternalValidation, types.ValidateAlways)
	}
}

func TestPurifyRunWithContext(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	result := callTool(t, s, "purify_run", map[string]any{
		"text":    "The system shall respond.",
		"context": "# Domain Context\nEntities: System",
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}

	// When context is provided, context_hint should not appear
	textContent := extractTextContent(t, result)
	if strings.Contains(textContent, "context_hint") {
		t.Error("context_hint should not appear when context is provided")
	}
}

func TestPurifyRunWithoutContext(t *testing.T) {
	t.Parallel()

	deps := mockDeps()
	s := newTestServer(deps)

	result := callTool(t, s, "purify_run", map[string]any{
		"text": "The system shall respond.",
	})

	if result.IsError {
		t.Fatalf("unexpected error: %v", result.Content)
	}

	textContent := extractTextContent(t, result)
	if !strings.Contains(textContent, "context_hint") {
		t.Error("context_hint should appear when no context is provided")
	}
}

func extractTextContent(t *testing.T, result *mcp.CallToolResult) string {
	t.Helper()

	if len(result.Content) == 0 {
		t.Fatal("no content in result")
	}

	b, _ := json.Marshal(result.Content[0])

	var tc mcp.TextContent
	if err := json.Unmarshal(b, &tc); err != nil {
		t.Fatalf("expected TextContent: %v", err)
	}

	return tc.Text
}
