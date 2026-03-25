package provider_test

import (
	"context"
	"testing"

	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

func TestMockLLMCallRepl(t *testing.T) {
	t.Parallel()

	mock := &provider.MockLLM{
		CallReplFn: func(_ context.Context, _ string, msgs []types.ConvMessage) (string, error) {
			return "mocked response for " + msgs[len(msgs)-1].Content, nil
		},
	}

	ctx := context.Background()
	msgs := []types.ConvMessage{{Role: "user", Content: "hello"}}

	result, err := mock.CallRepl(ctx, "system", msgs, provider.CallOpts{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "mocked response for hello" {
		t.Errorf("got %q, want %q", result, "mocked response for hello")
	}
}

func TestMockLLMCall(t *testing.T) {
	t.Parallel()

	mock := &provider.MockLLM{
		CallFn: func(_ context.Context, _, user string) (string, error) {
			return "response: " + user, nil
		},
	}

	ctx := context.Background()

	result, err := mock.Call(ctx, "system", "test input", provider.CallOpts{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "response: test input" {
		t.Errorf("got %q, want %q", result, "response: test input")
	}
}

func TestMockLLMCallDelegatesToRepl(t *testing.T) {
	t.Parallel()

	mock := &provider.MockLLM{
		CallReplFn: func(_ context.Context, _ string, msgs []types.ConvMessage) (string, error) {
			return "repl: " + msgs[0].Content, nil
		},
	}

	ctx := context.Background()

	result, err := mock.Call(ctx, "system", "delegated", provider.CallOpts{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "repl: delegated" {
		t.Errorf("got %q, want %q", result, "repl: delegated")
	}
}

func TestMockLLMEmptyFunctions(t *testing.T) {
	t.Parallel()

	mock := &provider.MockLLM{}
	ctx := context.Background()

	result, err := mock.CallRepl(ctx, "sys", nil, provider.CallOpts{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "" {
		t.Errorf("expected empty string, got %q", result)
	}
}

func TestDefaultModels(t *testing.T) {
	t.Parallel()

	if provider.DefaultModels[types.ProviderAnthropic] == "" {
		t.Error("missing default model for anthropic")
	}

	if provider.DefaultModels[types.ProviderOpenAI] == "" {
		t.Error("missing default model for openai")
	}

	if provider.DefaultCheapModels[types.ProviderAnthropic] == "" {
		t.Error("missing default cheap model for anthropic")
	}

	if provider.DefaultCheapModels[types.ProviderOpenAI] == "" {
		t.Error("missing default cheap model for openai")
	}
}

func TestNewAnthropic(t *testing.T) {
	t.Parallel()

	p := provider.NewAnthropic("sk-test", "claude-test")
	if p == nil {
		t.Fatal("NewAnthropic returned nil")
	}
}

func TestNewOpenAI(t *testing.T) {
	t.Parallel()

	p := provider.NewOpenAI("sk-test", "gpt-test", "")
	if p == nil {
		t.Fatal("NewOpenAI returned nil")
	}
}

func TestNewOpenAIWithBaseURL(t *testing.T) {
	t.Parallel()

	p := provider.NewOpenAI("sk-test", "gpt-test", "https://custom.api")
	if p == nil {
		t.Fatal("NewOpenAI with baseURL returned nil")
	}
}
