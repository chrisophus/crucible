// Package provider defines the LLM provider interface and implementations.
package provider

import (
	"context"
	"io"

	"github.com/chrisophus/crucible/internal/types"
)

// CallOpts configures a single LLM call.
type CallOpts struct {
	StreamTo io.Writer
	BaseURL  string
}

// LLM is the interface for language model providers.
type LLM interface {
	// Call sends a single-turn request (system + user message).
	Call(ctx context.Context, system, user string, opts CallOpts) (string, error)

	// CallRepl sends a multi-turn conversational request.
	CallRepl(ctx context.Context, system string, messages []types.ConvMessage, opts CallOpts) (string, error)
}

// DefaultModels maps providers to their default main models.
var DefaultModels = map[types.Provider]string{
	types.ProviderAnthropic: "claude-sonnet-4-6",
	types.ProviderOpenAI:    "gpt-4o",
}

// DefaultCheapModels maps providers to their default cheap models.
var DefaultCheapModels = map[types.Provider]string{
	types.ProviderAnthropic: "claude-haiku-4-5-20251001",
	types.ProviderOpenAI:    "gpt-4o-mini",
}
