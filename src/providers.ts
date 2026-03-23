import Anthropic from "@anthropic-ai/sdk"
import type { Message } from "@anthropic-ai/sdk/resources/messages.js"
import OpenAI from "openai"
import { TO_AISP_SYSTEM } from "./prompts.ts"
import type { ConvMessage, Provider } from "./types.ts"
import { runValidator } from "./validator.ts"

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
}

export const DEFAULT_CHEAP_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
}

function makeOpenAIClient(
  apiKey: string,
  baseUrl?: string,
  insecure?: boolean,
): OpenAI {
  let fetchImpl: typeof fetch | undefined
  if (insecure) {
    // Disable TLS verification for self-signed / corporate proxy certs
    const https = require("node:https") as typeof import("https")
    const agent = new https.Agent({ rejectUnauthorized: false })
    fetchImpl = (url, init) => {
      const { default: nodeFetch } = require("node-fetch") as {
        default: typeof fetch
      }
      return nodeFetch(
        url as string,
        { ...init, agent } as Parameters<typeof nodeFetch>[1],
      )
    }
  }
  return new OpenAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

export async function callLLM(
  provider: Provider,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  opts: {
    streamTo?: NodeJS.WritableStream
    thinking?: boolean
    baseUrl?: string
    openaiUser?: string
    insecure?: boolean
  } = {},
): Promise<string> {
  const { streamTo, thinking, baseUrl, openaiUser, insecure } = opts
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey })
    const params = {
      model,
      max_tokens: thinking ? 16000 : 8096,
      system: [
        {
          type: "text" as const,
          text: system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: user }],
      ...(thinking
        ? {
            thinking: { type: "enabled" as const, budget_tokens: 8000 },
            betas: ["interleaved-thinking-2025-05-14"],
          }
        : {}),
    } as Parameters<typeof client.messages.create>[0]
    if (streamTo) {
      const stream = client.messages.stream(params)
      let text = ""
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          streamTo.write(event.delta.text)
          text += event.delta.text
        }
      }
      return text
    }
    const msg = (await client.messages.create(params)) as Message
    const textBlock = msg.content.find(
      (b: { type: string }) => b.type === "text",
    ) as { type: "text"; text: string } | undefined
    return textBlock?.text ?? ""
  } else {
    const client = makeOpenAIClient(apiKey, baseUrl, insecure)
    if (streamTo) {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 8096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: true,
        ...(openaiUser ? { user: openaiUser } : {}),
      })
      let text = ""
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ""
        if (delta) {
          streamTo.write(delta)
          text += delta
        }
      }
      return text
    }
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 8096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(openaiUser ? { user: openaiUser } : {}),
    })
    return resp.choices[0].message.content ?? ""
  }
}

// Conversational call with full history and prompt caching
export async function callLLMRepl(
  provider: Provider,
  apiKey: string,
  model: string,
  system: string,
  messages: ConvMessage[],
  streamTo?: NodeJS.WritableStream,
  opts: { baseUrl?: string; openaiUser?: string; insecure?: boolean } = {},
): Promise<string> {
  const { baseUrl, openaiUser, insecure } = opts
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey })
    // System prompt takes 1 cache slot; cache up to 3 most recent prior messages.
    // Anthropic limit is 4 cache breakpoints per request.
    const anthropicMsgs = messages.map((m, i) => {
      const isLast = i === messages.length - 1
      const inCacheWindow = !isLast && i >= messages.length - 4
      return {
        role: m.role,
        content: inCacheWindow
          ? [
              {
                type: "text" as const,
                text: m.content,
                cache_control: { type: "ephemeral" as const },
              },
            ]
          : m.content,
      }
    })
    const params = {
      model,
      max_tokens: 8096,
      system: [
        {
          type: "text" as const,
          text: system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: anthropicMsgs,
    } as Parameters<typeof client.messages.create>[0]
    if (streamTo) {
      const stream = client.messages.stream(params)
      let text = ""
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          streamTo.write(event.delta.text)
          text += event.delta.text
        }
      }
      return text
    }
    const msg = (await client.messages.create(params)) as Message
    return (msg.content[0] as { text: string }).text
  } else {
    const client = makeOpenAIClient(apiKey, baseUrl, insecure)
    if (streamTo) {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 8096,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
        ...(openaiUser ? { user: openaiUser } : {}),
      })
      let text = ""
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ""
        if (delta) {
          streamTo.write(delta)
          text += delta
        }
      }
      return text
    }
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 8096,
      messages: [{ role: "system", content: system }, ...messages],
      ...(openaiUser ? { user: openaiUser } : {}),
    })
    return resp.choices[0].message.content ?? ""
  }
}

// Anthropic-only: tool-use loop that lets the model self-validate AISP before finalizing
const VALIDATOR_TOOL = {
  name: "validate_aisp",
  description:
    "Validate an AISP 5.1 document and return semantic density (δ) and tier. Call after generating AISP to check quality before finalizing.",
  input_schema: {
    type: "object" as const,
    properties: {
      aisp: {
        type: "string",
        description: "The complete AISP 5.1 document to validate",
      },
    },
    required: ["aisp"],
  },
}

const TO_AISP_SYSTEM_WITH_TOOLS =
  TO_AISP_SYSTEM +
  `

After generating the AISP document, call validate_aisp with it to check semantic density.
If δ < 0.40, revise the document and call validate_aisp once more.
Output your final AISP as plain text when done.`

export async function callLLMWithTools(
  apiKey: string,
  model: string,
  user: string,
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const msgs: Parameters<typeof client.messages.create>[0]["messages"] = [
    { role: "user", content: user },
  ]
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = (await client.messages.create({
      model,
      max_tokens: 8096,
      system: [
        {
          type: "text" as const,
          text: TO_AISP_SYSTEM_WITH_TOOLS,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [VALIDATOR_TOOL],
      messages: msgs,
    } as Parameters<typeof client.messages.create>[0])) as Message

    if (resp.stop_reason !== "tool_use") {
      const textBlock = (resp.content as Array<{ type: string }>).find(
        (b) => b.type === "text",
      ) as { type: "text"; text: string } | undefined
      return textBlock?.text ?? ""
    }

    msgs.push({
      role: "assistant",
      content: resp.content as Parameters<
        typeof client.messages.create
      >[0]["messages"][number]["content"],
    })

    const toolResults: Array<{
      type: "tool_result"
      tool_use_id: string
      content: string
    }> = []
    for (const block of resp.content) {
      if (block.type === "tool_use" && block.name === "validate_aisp") {
        const input = block.input as { aisp: string }
        const result = await runValidator(input.aisp)
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result ?? { error: "validator unavailable" }),
        })
      }
    }
    msgs.push({
      role: "user",
      content: toolResults as Parameters<
        typeof client.messages.create
      >[0]["messages"][number]["content"],
    })
  }
  throw new Error("unreachable")
}

export { TO_AISP_SYSTEM_WITH_TOOLS }
