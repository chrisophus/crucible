package config_test

import (
	"testing"

	"github.com/chrisophus/crucible/internal/config"
	"github.com/chrisophus/crucible/internal/types"
)

func TestResolveWithExplicitValues(t *testing.T) {
	t.Parallel()

	opts := config.LLMOpts{
		APIKey:     "sk-test",
		Provider:   types.ProviderAnthropic,
		Model:      "custom-model",
		CheapModel: "custom-cheap",
		BaseURL:    "https://custom.api",
	}

	resolved, err := config.Resolve(opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resolved.Provider != types.ProviderAnthropic {
		t.Errorf("Provider = %q, want %q", resolved.Provider, types.ProviderAnthropic)
	}

	if resolved.MainModel != "custom-model" {
		t.Errorf("MainModel = %q, want %q", resolved.MainModel, "custom-model")
	}

	if resolved.CheapModel != "custom-cheap" {
		t.Errorf("CheapModel = %q, want %q", resolved.CheapModel, "custom-cheap")
	}

	if resolved.APIKey != "sk-test" {
		t.Errorf("APIKey = %q, want %q", resolved.APIKey, "sk-test")
	}

	if resolved.BaseURL != "https://custom.api" {
		t.Errorf("BaseURL = %q, want %q", resolved.BaseURL, "https://custom.api")
	}
}

func TestResolveDefaultProvider(t *testing.T) {
	t.Parallel()

	opts := config.LLMOpts{APIKey: "sk-test"}

	resolved, err := config.Resolve(opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resolved.Provider != types.ProviderAnthropic {
		t.Errorf("Provider = %q, want %q", resolved.Provider, types.ProviderAnthropic)
	}
}

func TestResolveDefaultModels(t *testing.T) {
	t.Parallel()

	opts := config.LLMOpts{
		APIKey:   "sk-test",
		Provider: types.ProviderOpenAI,
	}

	resolved, err := config.Resolve(opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resolved.MainModel == "" {
		t.Error("MainModel should not be empty")
	}

	if resolved.CheapModel == "" {
		t.Error("CheapModel should not be empty")
	}
}

func TestResolveMissingAPIKey(t *testing.T) {
	t.Parallel()

	opts := config.LLMOpts{Provider: types.ProviderAnthropic}

	_, err := config.Resolve(opts)
	if err == nil {
		t.Fatal("expected error for missing API key")
	}
}
