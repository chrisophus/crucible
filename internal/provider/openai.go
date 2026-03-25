package provider

import (
	"context"
	"crypto/tls"
	"net/http"

	"github.com/chrisophus/crucible/internal/types"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

// OpenAIProvider implements LLM using the OpenAI API.
type OpenAIProvider struct {
	client openai.Client
	model  string
	user   string
}

// OpenAIOpts holds optional configuration for the OpenAI provider.
type OpenAIOpts struct {
	User     string
	Insecure bool
}

// NewOpenAI creates an OpenAI LLM provider.
func NewOpenAI(apiKey, model string, baseURL string) *OpenAIProvider {
	return NewOpenAIWithOpts(apiKey, model, baseURL, OpenAIOpts{})
}

// NewOpenAIWithOpts creates an OpenAI LLM provider with extended options.
func NewOpenAIWithOpts(apiKey, model, baseURL string, opts OpenAIOpts) *OpenAIProvider {
	reqOpts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		reqOpts = append(reqOpts, option.WithBaseURL(baseURL))
	}

	if opts.Insecure {
		httpClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					MinVersion:         tls.VersionTLS12,
					InsecureSkipVerify: true, //nolint:gosec // user-requested insecure mode
				},
			},
		}
		reqOpts = append(reqOpts, option.WithHTTPClient(httpClient))
	}

	client := openai.NewClient(reqOpts...)

	return &OpenAIProvider{client: client, model: model, user: opts.User}
}

// Call sends a single-turn message to OpenAI.
func (o *OpenAIProvider) Call(
	ctx context.Context,
	system, user string,
	opts CallOpts,
) (string, error) {
	msgs := []types.ConvMessage{{Role: "user", Content: user}}

	return o.CallRepl(ctx, system, msgs, opts)
}

// CallRepl sends a multi-turn conversation to OpenAI.
func (o *OpenAIProvider) CallRepl(
	ctx context.Context,
	system string,
	messages []types.ConvMessage,
	opts CallOpts,
) (string, error) {
	chatMsgs := buildOpenAIMessages(system, messages)

	debugLogRequest(opts, "openai", o.model, system, messages)

	params := openai.ChatCompletionNewParams{
		Model:     o.model,
		MaxTokens: openai.Int(8096),
		Messages:  chatMsgs,
	}

	if o.user != "" {
		params.User = openai.String(o.user)
	}

	resp, err := o.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return "", err
	}

	if len(resp.Choices) == 0 {
		return "", nil
	}

	result := resp.Choices[0].Message.Content
	debugLogResponse(opts, "openai", result)

	return result, nil
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
