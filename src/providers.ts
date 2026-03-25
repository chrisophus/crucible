import Anthropic from "@anthropic-ai/sdk"
import type { Message } from "@anthropic-ai/sdk/resources/messages.js"
import OpenAI from "openai"
import { TO_AISP_SYSTEM } from "./prompts.ts"
import type { ConvMessage, Provider } from "./types.ts"
import { runValidator } from "./validator.ts"

// ── Debug logging ──────────────────────────────────────────────────────────────

export interface DebugOpts {
  /** Log every request/response summary and all errors to stderr. */
  debug?: boolean
  /** Log full request/response content grouped by type (implies debug). */
  veryVerbose?: boolean
}

let _callCounter = 0

function debugLog(
  kind: "request" | "response" | "error",
  opts: DebugOpts,
  data: {
    callId: number
    model?: string
    provider?: string
    label?: string
    messages?: ConvMessage[]
    system?: string
    user?: string
    response?: string
    error?: unknown
  },
): void {
  if (!opts.debug) return

  const tag = `[LLM:${kind.toUpperCase()}#${data.callId}]`
  const parts: string[] = []

  if (kind === "request") {
    const header = [
      tag,
      data.label ? ` ${data.label}` : "",
      `  provider=${data.provider ?? "?"}  model=${data.model ?? "?"}`,
    ].join("")
    parts.push(header)

    if (opts.veryVerbose) {
      if (data.system !== undefined) {
        parts.push(
          `  [REQUEST:system] (${data.system.length} chars)\n${indent(data.system)}`,
        )
      }
      if (data.user !== undefined) {
        parts.push(
          `  [REQUEST:user] (${data.user.length} chars)\n${indent(data.user)}`,
        )
      }
      if (data.messages !== undefined) {
        for (const m of data.messages) {
          parts.push(
            `  [REQUEST:${m.role}] (${m.content.length} chars)\n${indent(m.content)}`,
          )
        }
      }
    } else {
      if (data.messages !== undefined) {
        const counts = data.messages.map(
          (m) => `${m.role}(${m.content.length}ch)`,
        )
        parts.push(`  messages: [${counts.join(", ")}]`)
      }
      if (data.user !== undefined) {
        parts.push(`  user: ${data.user.length} chars`)
      }
    }
  } else if (kind === "response") {
    const len = data.response?.length ?? 0
    parts.push(`${tag}  chars=${len}`)

    if (opts.veryVerbose && data.response !== undefined) {
      parts.push(
        `  [RESPONSE:assistant] (${len} chars)\n${indent(data.response)}`,
      )
    }
  } else {
    // error — always emit when debug is on
    parts.push(`${tag}  model=${data.model ?? "?"}`)
    if (data.error instanceof Error) {
      parts.push(`  message: ${data.error.message}`)
      const e = data.error as unknown as Record<string, unknown>
      if (e.status !== undefined) parts.push(`  status: ${e.status}`)
      if (e.code !== undefined) parts.push(`  code: ${e.code}`)
    } else {
      parts.push(`  ${String(data.error)}`)
    }
  }

  process.stderr.write(`${parts.join("\n")}\n`)
}

function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n")
}

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
  if (insecure) {
    // Disable TLS cert verification process-wide (safe for a CLI tool).
    // Must be set before the first fetch so the undici/native-fetch dispatcher picks it up.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  }
  return new OpenAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
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
    debug?: boolean
    veryVerbose?: boolean
  } = {},
): Promise<string> {
  const { streamTo, thinking, baseUrl, openaiUser, insecure } = opts
  const dbg: DebugOpts = { debug: opts.debug, veryVerbose: opts.veryVerbose }
  const callId = ++_callCounter

  debugLog("request", dbg, {
    callId,
    label: "callLLM",
    provider,
    model,
    system,
    user,
  })

  try {
    let result: string
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
        result = text
      } else {
        const msg = (await client.messages.create(params)) as Message
        const textBlock = msg.content.find(
          (b: { type: string }) => b.type === "text",
        ) as { type: "text"; text: string } | undefined
        result = textBlock?.text ?? ""
      }
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
        result = text
      } else {
        const resp = await client.chat.completions.create({
          model,
          max_tokens: 8096,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(openaiUser ? { user: openaiUser } : {}),
        })
        result = resp.choices[0].message.content ?? ""
      }
    }

    debugLog("response", dbg, { callId, model, response: result })
    return result
  } catch (err) {
    debugLog("error", dbg, { callId, model, error: err })
    throw err
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
  opts: {
    baseUrl?: string
    openaiUser?: string
    insecure?: boolean
    debug?: boolean
    veryVerbose?: boolean
  } = {},
): Promise<string> {
  const { baseUrl, openaiUser, insecure } = opts
  const dbg: DebugOpts = { debug: opts.debug, veryVerbose: opts.veryVerbose }
  const callId = ++_callCounter

  debugLog("request", dbg, {
    callId,
    label: "callLLMRepl",
    provider,
    model,
    system,
    messages,
  })

  try {
    let result: string
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
        result = text
      } else {
        const msg = (await client.messages.create(params)) as Message
        result = (msg.content[0] as { text: string }).text
      }
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
        result = text
      } else {
        const resp = await client.chat.completions.create({
          model,
          max_tokens: 8096,
          messages: [{ role: "system", content: system }, ...messages],
          ...(openaiUser ? { user: openaiUser } : {}),
        })
        result = resp.choices[0].message.content ?? ""
      }
    }

    debugLog("response", dbg, { callId, model, response: result })
    return result
  } catch (err) {
    debugLog("error", dbg, { callId, model, error: err })
    throw err
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
  dbgOpts: DebugOpts = {},
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const callId = ++_callCounter
  const dbg: DebugOpts = dbgOpts

  debugLog("request", dbg, {
    callId,
    label: "callLLMWithTools",
    provider: "anthropic",
    model,
    user,
  })

  const msgs: Parameters<typeof client.messages.create>[0]["messages"] = [
    { role: "user", content: user },
  ]

  try {
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
        const result = textBlock?.text ?? ""
        debugLog("response", dbg, { callId, model, response: result })
        return result
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
            content: JSON.stringify(
              result ?? { error: "validator unavailable" },
            ),
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
  } catch (err) {
    debugLog("error", dbg, { callId, model, error: err })
    throw err
  }
}

export { TO_AISP_SYSTEM_WITH_TOOLS }
