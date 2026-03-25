package provider

import (
	"context"

	"github.com/chrisophus/crucible/internal/types"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

// OpenAIProvider implements LLM using the OpenAI API.
type OpenAIProvider struct {
	client openai.Client
	model  string
}

// NewOpenAI creates an OpenAI LLM provider.
func NewOpenAI(apiKey, model string, baseURL string) *OpenAIProvider {
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}

	client := openai.NewClient(opts...)

	return &OpenAIProvider{client: client, model: model}
}

// Call sends a single-turn message to OpenAI.
func (o *OpenAIProvider) Call(
	ctx context.Context,
	system, user string,
	_ CallOpts,
) (string, error) {
	msgs := []types.ConvMessage{{Role: "user", Content: user}}

	return o.CallRepl(ctx, system, msgs, CallOpts{})
}

// CallRepl sends a multi-turn conversation to OpenAI.
func (o *OpenAIProvider) CallRepl(
	ctx context.Context,
	system string,
	messages []types.ConvMessage,
	_ CallOpts,
) (string, error) {
	chatMsgs := buildOpenAIMessages(system, messages)

	resp, err := o.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model:     o.model,
		MaxTokens: openai.Int(8096),
		Messages:  chatMsgs,
	})
	if err != nil {
		return "", err
	}

	if len(resp.Choices) == 0 {
		return "", nil
	}

	return resp.Choices[0].Message.Content, nil
}

func buildOpenAIMessages(
	system string,
	messages []types.ConvMessage,
) []openai.ChatCompletionMessageParamUnion {
	result := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages)+1)
	result = append(result, openai.SystemMessage(system))

	for _, m := range messages {
		switch m.Role {
		case "user":
			result = append(result, openai.UserMessage(m.Content))
		case "assistant":
			result = append(result, openai.AssistantMessage(m.Content))
		}
	}

	return result
}
