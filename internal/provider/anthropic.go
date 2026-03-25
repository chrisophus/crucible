package provider

import (
	"context"
	"fmt"
	"os"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/chrisophus/crucible/internal/types"
)

const (
	defaultMaxTokens  int64 = 8096
	thinkingMaxTokens int64 = 16000
	thinkingBudget    int64 = 8000
	defaultCountModel       = "claude-haiku-4-5-20251001"
)

// AnthropicProvider implements LLM using the Anthropic API.
type AnthropicProvider struct {
	client   anthropic.Client
	model    string
	thinking bool
}

// AnthropicOpts holds optional configuration for the Anthropic provider.
type AnthropicOpts struct {
	Thinking bool
}

// NewAnthropic creates an Anthropic LLM provider.
func NewAnthropic(apiKey, model string) *AnthropicProvider {
	return NewAnthropicWithOpts(apiKey, model, AnthropicOpts{})
}

// NewAnthropicWithOpts creates an Anthropic LLM provider with extended options.
func NewAnthropicWithOpts(apiKey, model string, opts AnthropicOpts) *AnthropicProvider {
	client := anthropic.NewClient(option.WithAPIKey(apiKey))

	return &AnthropicProvider{client: client, model: model, thinking: opts.Thinking}
}

// Call sends a single-turn message to Anthropic.
func (a *AnthropicProvider) Call(
	ctx context.Context,
	system, user string,
	opts CallOpts,
) (string, error) {
	msgs := []types.ConvMessage{{Role: "user", Content: user}}

	return a.CallRepl(ctx, system, msgs, opts)
}

// CallRepl sends a multi-turn conversation to Anthropic.
func (a *AnthropicProvider) CallRepl(
	ctx context.Context,
	system string,
	messages []types.ConvMessage,
	opts CallOpts,
) (string, error) {
	anthMsgs := buildAnthropicMessages(messages)

	params := anthropic.MessageNewParams{
		Model:     a.model,
		MaxTokens: defaultMaxTokens,
		System: []anthropic.TextBlockParam{
			{Text: system},
		},
		Messages: anthMsgs,
	}

	thinking := a.thinking || opts.Thinking
	if thinking {
		params.MaxTokens = thinkingMaxTokens
		params.Thinking = anthropic.ThinkingConfigParamOfEnabled(thinkingBudget)
	}

	debugLogRequest(opts, "anthropic", a.model, system, messages)

	resp, err := a.client.Messages.New(ctx, params)
	if err != nil {
		return "", err
	}

	result := extractTextContent(resp)
	debugLogResponse(opts, "anthropic", result)

	return result, nil
}

// CountTokens counts the input tokens for a message without sending it.
func (a *AnthropicProvider) CountTokens(
	ctx context.Context,
	system, user string,
	model string,
) (int64, error) {
	if model == "" {
		model = a.model
	}

	resp, err := a.client.Messages.CountTokens(ctx, anthropic.MessageCountTokensParams{
		Model: model,
		System: anthropic.MessageCountTokensParamsSystemUnion{
			OfString: anthropic.Opt(system),
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(user)),
		},
	})
	if err != nil {
		return 0, err
	}

	return resp.InputTokens, nil
}

func buildAnthropicMessages(messages []types.ConvMessage) []anthropic.MessageParam {
	result := make([]anthropic.MessageParam, 0, len(messages))

	for _, m := range messages {
		switch m.Role {
		case "user":
			result = append(result, anthropic.NewUserMessage(
				anthropic.NewTextBlock(m.Content),
			))
		case "assistant":
			result = append(result, anthropic.NewAssistantMessage(
				anthropic.NewTextBlock(m.Content),
			))
		}
	}

	return result
}

func extractTextContent(resp *anthropic.Message) string {
	for _, block := range resp.Content {
		if block.Type == "text" {
			return block.Text
		}
	}

	return ""
}

func debugLogRequest(opts CallOpts, provider, model, system string, msgs []types.ConvMessage) {
	if !opts.Debug {
		return
	}

	fmt.Fprintf(os.Stderr, "[debug] %s call: model=%s messages=%d\n", provider, model, len(msgs))

	if opts.VeryVerbose {
		fmt.Fprintf(os.Stderr, "[debug] system prompt (%d chars):\n%s\n", len(system), truncate(system, 500))

		for i, m := range msgs {
			fmt.Fprintf(os.Stderr, "[debug] message[%d] role=%s (%d chars):\n%s\n",
				i, m.Role, len(m.Content), truncate(m.Content, 500))
		}
	}
}

func debugLogResponse(opts CallOpts, provider, result string) {
	if !opts.Debug {
		return
	}

	fmt.Fprintf(os.Stderr, "[debug] %s response: %d chars\n", provider, len(result))

	if opts.VeryVerbose {
		fmt.Fprintf(os.Stderr, "[debug] response content:\n%s\n", truncate(result, 1000))
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}

	return s[:maxLen] + "... (truncated)"
}
