// Package config resolves LLM options from flags, env vars, and defaults.
package config

import (
	"errors"
	"os"

	"github.com/chrisophus/crucible/internal/provider"
	"github.com/chrisophus/crucible/internal/types"
)

// ErrMissingAPIKey is returned when the required API key is not set.
var ErrMissingAPIKey = errors.New("API key not set")

// LLMOpts holds user-specified LLM options (from flags or env).
type LLMOpts struct {
	APIKey     string
	Provider   types.Provider
	Model      string
	CheapModel string
	BaseURL    string
}

// ResolvedOpts holds fully resolved LLM configuration.
type ResolvedOpts struct {
	Provider   types.Provider
	MainModel  string
	CheapModel string
	APIKey     string
	BaseURL    string
}

// Resolve fills in defaults and environment variables.
func Resolve(opts LLMOpts) (ResolvedOpts, error) {
	prov := resolveProvider(opts.Provider)
	mainModel := resolveModel(opts.Model, prov)
	cheapModel := resolveCheapModel(opts.CheapModel, prov)

	apiKey, err := resolveAPIKey(opts.APIKey, prov)
	if err != nil {
		return ResolvedOpts{}, err
	}

	return ResolvedOpts{
		Provider:   prov,
		MainModel:  mainModel,
		CheapModel: cheapModel,
		APIKey:     apiKey,
		BaseURL:    opts.BaseURL,
	}, nil
}

func resolveProvider(p types.Provider) types.Provider {
	if p != "" {
		return p
	}

	if env := os.Getenv("PURIFY_PROVIDER"); env != "" {
		return types.Provider(env)
	}

	return types.ProviderAnthropic
}

func resolveModel(model string, prov types.Provider) string {
	if model != "" {
		return model
	}

	if env := os.Getenv("PURIFY_MODEL"); env != "" {
		return env
	}

	return provider.DefaultModels[prov]
}

func resolveCheapModel(model string, prov types.Provider) string {
	if model != "" {
		return model
	}

	if env := os.Getenv("PURIFY_MODEL_CHEAP"); env != "" {
		return env
	}

	return provider.DefaultCheapModels[prov]
}

func resolveAPIKey(key string, prov types.Provider) (string, error) {
	if key != "" {
		return key, nil
	}

	envVars := map[types.Provider]string{
		types.ProviderAnthropic: "ANTHROPIC_API_KEY",
		types.ProviderOpenAI:    "OPENAI_API_KEY",
	}

	envKey := os.Getenv(envVars[prov])
	if envKey == "" {
		return "", ErrMissingAPIKey
	}

	return envKey, nil
}
