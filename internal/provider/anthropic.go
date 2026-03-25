package provider

import (
	"context"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/chrisophus/crucible/internal/types"
)

// AnthropicProvider implements LLM using the Anthropic API.
type AnthropicProvider struct {
	client anthropic.Client
	model  string
}

// NewAnthropic creates an Anthropic LLM provider.
func NewAnthropic(apiKey, model string) *AnthropicProvider {
	client := anthropic.NewClient(option.WithAPIKey(apiKey))

	return &AnthropicProvider{client: client, model: model}
}

// Call sends a single-turn message to Anthropic.
func (a *AnthropicProvider) Call(
	ctx context.Context,
	system, user string,
	_ CallOpts,
) (string, error) {
	msgs := []types.ConvMessage{{Role: "user", Content: user}}

	return a.CallRepl(ctx, system, msgs, CallOpts{})
}

// CallRepl sends a multi-turn conversation to Anthropic.
func (a *AnthropicProvider) CallRepl(
	ctx context.Context,
	system string,
	messages []types.ConvMessage,
	_ CallOpts,
) (string, error) {
	anthMsgs := buildAnthropicMessages(messages)

	resp, err := a.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     a.model,
		MaxTokens: 8096,
		System: []anthropic.TextBlockParam{
			{Text: system},
		},
		Messages: anthMsgs,
	})
	if err != nil {
		return "", err
	}

	return extractTextContent(resp), nil
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
