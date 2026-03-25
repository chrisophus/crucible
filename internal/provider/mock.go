package provider

import (
	"context"

	"github.com/chrisophus/crucible/internal/types"
)

// MockLLM is a test double for the LLM interface.
type MockLLM struct {
	// CallFn is invoked for single-turn calls.
	CallFn func(ctx context.Context, system, user string) (string, error)

	// CallReplFn is invoked for multi-turn calls.
	CallReplFn func(ctx context.Context, system string, messages []types.ConvMessage) (string, error)
}

// Call delegates to CallFn or CallReplFn.
func (m *MockLLM) Call(
	ctx context.Context,
	system, user string,
	_ CallOpts,
) (string, error) {
	if m.CallFn != nil {
		return m.CallFn(ctx, system, user)
	}

	msgs := []types.ConvMessage{{Role: "user", Content: user}}

	return m.CallRepl(ctx, system, msgs, CallOpts{})
}

// CallRepl delegates to CallReplFn.
func (m *MockLLM) CallRepl(
	ctx context.Context,
	system string,
	messages []types.ConvMessage,
	_ CallOpts,
) (string, error) {
	if m.CallReplFn != nil {
		return m.CallReplFn(ctx, system, messages)
	}

	return "", nil
}
