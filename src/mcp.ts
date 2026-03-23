#!/usr/bin/env tsx
/**
 * purify MCP server — exposes purify spec purification as MCP tools
 *
 * Usage (stdio transport):
 *   purify-mcp
 *
 * Environment:
 *   ANTHROPIC_API_KEY  OPENAI_API_KEY
 *   PURIFY_PROVIDER    PURIFY_MODEL    PURIFY_MODEL_CHEAP
 *
 * Claude Desktop config example (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "purify": {
 *         "command": "purify-mcp",
 *         "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

import { purify } from "./core.ts"
import {
  clarifyTranslation,
  initContext,
  reflectText,
  translateText,
  updatePurified,
} from "./core-tools.ts"
import { DEFAULT_CHEAP_MODELS, DEFAULT_MODELS } from "./providers.ts"
import type { Mode, Provider } from "./types.ts"
import { parseEvidence, runValidator } from "./validator.ts"

const VALID_MODES: Mode[] = [
  "formal",
  "narrative",
  "hybrid",
  "sketch",
  "summary",
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveApiKey(provider: Provider): string {
  const envVars: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  }
  const key = process.env[envVars[provider]]
  if (!key)
    throw new Error(`${envVars[provider]} environment variable is not set`)
  return key
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "purify_spec",
    description:
      "Purify a specification by translating it through AISP 5.1 (AI Symbolic Protocol) " +
      "to expose hidden ambiguities. Returns a quality score and the purified English version " +
      "of the specification. The round-trip process forces every constraint, enumeration, and " +
      "relationship to be explicit, reducing ambiguity.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "The specification text to purify (English prose or markdown)",
        },
        mode: {
          type: "string",
          enum: VALID_MODES,
          description:
            "Output mode for the purified English. " +
            "formal=structured tables; narrative=flowing prose (default); " +
            "hybrid=balanced; sketch=high-level bullets; summary=plain executive summary",
          default: "narrative",
        },
        provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "LLM provider to use (default: anthropic)",
          default: "anthropic",
        },
        model: {
          type: "string",
          description:
            "Main model for AISP→English step (default: claude-sonnet-4-6)",
        },
        purify_model: {
          type: "string",
          description:
            "Cheap model for English→AISP step (default: claude-haiku-4-5-20251001)",
        },
        from_aisp: {
          type: "boolean",
          description:
            "Set to true if the input is already an AISP document (skip step 1)",
          default: false,
        },
      },
      required: ["text"],
    },
  },
  {
    name: "validate_aisp",
    description:
      "Validate an AISP 5.1 document and compute its semantic density score (δ). " +
      "Returns validity, delta score (0–1), quality tier, and ambiguity metric. " +
      "Tiers: ◊⁺⁺ platinum (δ≥0.75), ◊⁺ gold (δ≥0.60), ◊ silver (δ≥0.40), " +
      "◊⁻ bronze (δ≥0.20), ⊘ invalid (δ<0.20).",
    inputSchema: {
      type: "object",
      properties: {
        aisp: {
          type: "string",
          description: "The AISP 5.1 document to validate",
        },
      },
      required: ["aisp"],
    },
  },
  {
    name: "purify_reflect",
    description:
      "Step 1 of the translation loop. The model states its interpretation of the text " +
      "BEFORE formalizing it, so the author can correct any misunderstandings. " +
      "Returns interpretation, explicit assumptions, and uncertainties. " +
      "Never attempts formalization or generates AISP.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The raw text to interpret",
        },
        context: {
          type: "string",
          description: "Optional project domain context from purify.context.md",
        },
        provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "LLM provider (default: anthropic)",
          default: "anthropic",
        },
        model: {
          type: "string",
          description: "Model to use (default: claude-sonnet-4-6)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "purify_translate",
    description:
      "Step 2 of the translation loop. Translates natural language through AISP to precise English. " +
      "Returns purified English, AISP intermediate, quality scores (δ, φ, τ), " +
      "contradiction list (blocks output if non-empty), and clarification questions. " +
      "Scores: ◊⁺⁺ platinum (δ≥0.75,φ≥95), ◊⁺ gold (δ≥0.60,φ≥80), " +
      "◊ silver (δ≥0.40,φ≥65), ◊⁻ bronze (δ≥0.20,φ≥40), ⊘ invalid.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The raw text to translate",
        },
        context: {
          type: "string",
          description: "Optional project domain context from purify.context.md",
        },
        interpretation: {
          type: "string",
          description: "Corrected interpretation from a prior purify_reflect call",
        },
        provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "LLM provider (default: anthropic)",
          default: "anthropic",
        },
        model: {
          type: "string",
          description: "Main model for AISP→English step (default: claude-sonnet-4-6)",
        },
        cheap_model: {
          type: "string",
          description: "Cheap model for English→AISP step (default: claude-haiku-4-5-20251001)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "purify_clarify",
    description:
      "Iterative refinement step. Takes an existing AISP document and answers to clarifying questions, " +
      "then returns an updated translation with improved scores. " +
      "Repeat until τ ≥ ◊⁺ or the author accepts the current tier.",
    inputSchema: {
      type: "object",
      properties: {
        aisp: {
          type: "string",
          description: "The existing AISP document from a prior purify_translate or purify_clarify call",
        },
        context: {
          type: "string",
          description: "Optional project domain context from purify.context.md",
        },
        answers: {
          type: "array",
          description: "Answers to the clarifying questions from the prior translation result",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The clarifying question" },
              answer: { type: "string", description: "The author's answer" },
            },
            required: ["question", "answer"],
          },
        },
        provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "LLM provider (default: anthropic)",
          default: "anthropic",
        },
        model: {
          type: "string",
          description: "Model to use (default: claude-sonnet-4-6)",
        },
      },
      required: ["aisp", "answers"],
    },
  },
  {
    name: "purify_update",
    description:
      "Updates existing purified content in place. Edits only the affected sections — " +
      "never regenerates from scratch. Preserves the style, spirit, and flow of unchanged sections. " +
      "Returns the updated purified text, updated AISP, scores, a section-level diff, and contradiction check.",
    inputSchema: {
      type: "object",
      properties: {
        existing_purified: {
          type: "string",
          description: "The current purified English text to update",
        },
        existing_aisp: {
          type: "string",
          description: "The current AISP document corresponding to the purified text",
        },
        change: {
          type: "string",
          description: "Natural language description of the requested change",
        },
        context: {
          type: "string",
          description: "Optional project domain context from purify.context.md",
        },
        provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "LLM provider (default: anthropic)",
          default: "anthropic",
        },
        model: {
          type: "string",
          description: "Model to use (default: claude-sonnet-4-6)",
        },
      },
      required: ["existing_purified", "existing_aisp", "change"],
    },
  },
  {
    name: "purify_init",
    description:
      "One-time project setup. Reads existing project files (specs, schemas, docs, AISP files) " +
      "and generates the content for purify.context.md — a domain model that improves all subsequent " +
      "purify calls for this project.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "Absolute or relative paths to project files to extract context from",
          items: { type: "string" },
        },
        provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "LLM provider (default: anthropic)",
          default: "anthropic",
        },
        model: {
          type: "string",
          description: "Model to use (default: claude-sonnet-4-6)",
        },
      },
      required: ["files"],
    },
  },
  {
    name: "parse_aisp_evidence",
    description:
      "Extract the self-reported quality evidence from an AISP 5.1 document's ⟦Ε⟧ block. " +
      "Returns the delta score and tier symbol reported by the model that generated the AISP.",
    inputSchema: {
      type: "object",
      properties: {
        aisp: {
          type: "string",
          description: "The AISP 5.1 document to parse",
        },
      },
      required: ["aisp"],
    },
  },
]

// ── Server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "purify", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (name === "purify_reflect") {
      const { text, context, provider = "anthropic", model } = args as {
        text: string
        context?: string
        provider?: Provider
        model?: string
      }
      const result = await reflectText(text, context, { provider, model })
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_translate") {
      const {
        text,
        context,
        interpretation,
        provider = "anthropic",
        model,
        cheap_model,
      } = args as {
        text: string
        context?: string
        interpretation?: string
        provider?: Provider
        model?: string
        cheap_model?: string
      }
      const result = await translateText(text, context, interpretation, {
        provider,
        model,
        cheapModel: cheap_model,
      })
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_clarify") {
      const {
        aisp,
        context,
        answers,
        provider = "anthropic",
        model,
      } = args as {
        aisp: string
        context?: string
        answers: Array<{ question: string; answer: string }>
        provider?: Provider
        model?: string
      }
      const result = await clarifyTranslation(aisp, context, answers, { provider, model })
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_update") {
      const {
        existing_purified,
        existing_aisp,
        change,
        context,
        provider = "anthropic",
        model,
      } = args as {
        existing_purified: string
        existing_aisp: string
        change: string
        context?: string
        provider?: Provider
        model?: string
      }
      const result = await updatePurified(existing_purified, existing_aisp, change, context, {
        provider,
        model,
      })
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_init") {
      const { files, provider = "anthropic", model } = args as {
        files: string[]
        provider?: Provider
        model?: string
      }
      const result = await initContext(files, { provider, model })
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_spec") {
      const {
        text,
        mode = "narrative",
        provider = "anthropic",
        model,
        purify_model,
        from_aisp = false,
      } = args as {
        text: string
        mode?: Mode
        provider?: Provider
        model?: string
        purify_model?: string
        from_aisp?: boolean
      }

      const resolvedProvider = provider as Provider
      const mainModel =
        model ?? process.env.PURIFY_MODEL ?? DEFAULT_MODELS[resolvedProvider]
      const purifyModel =
        purify_model ??
        process.env.PURIFY_MODEL_CHEAP ??
        DEFAULT_CHEAP_MODELS[resolvedProvider]
      const apiKey = resolveApiKey(resolvedProvider)

      const result = await purify({
        text,
        provider: resolvedProvider,
        mainModel,
        purifyModel,
        apiKey,
        verbose: false,
        mode: mode as Mode,
        fromAisp: from_aisp,
        baseUrl: process.env.OPENAI_BASE_URL,
        openaiUser: process.env.OPENAI_USER,
        insecure: process.env.OPENAI_INSECURE === "1",
      })

      return {
        content: [{ type: "text", text: result }],
      }
    }

    if (name === "validate_aisp") {
      const { aisp } = args as { aisp: string }
      const result = await runValidator(aisp)
      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "validator unavailable" }),
            },
          ],
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      }
    }

    if (name === "parse_aisp_evidence") {
      const { aisp } = args as { aisp: string }
      const evidence = parseEvidence(aisp)
      return {
        content: [{ type: "text", text: JSON.stringify(evidence, null, 2) }],
      }
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
      isError: true,
    }
  }
})

// ── Start ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
