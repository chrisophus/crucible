/**
 * purify MCP server — v3 session-based pipeline
 *
 * Tools: purify_run, purify_clarify, purify_translate, purify_update, purify_init
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

// ── Help ───────────────────────────────────────────────────────────────────────

if (process.argv.includes("--help") || process.argv.includes("-h") || process.stdin.isTTY) {
  process.stdout.write(`\
purify-mcp — purify MCP server (stdio transport)

This command is meant to be invoked by an MCP client, not run directly.

Configure it in your MCP client:

  Claude Code (~/.claude/settings.json):
    {
      "mcpServers": {
        "purify": {
          "command": "purify-mcp",
          "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
        }
      }
    }

  Claude Desktop (~/.claude/claude_desktop_config.json):
    same format as above

Tools exposed: purify_run, purify_clarify, purify_translate, purify_update, purify_patch, purify_init

Environment:
  ANTHROPIC_API_KEY    OPENAI_API_KEY
  PURIFY_PROVIDER      PURIFY_MODEL    PURIFY_MODEL_CHEAP
`)
  process.exit(0)
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

import {
  initContext,
  runClarifyPipeline,
  runPatchPipeline,
  runPurifyPipeline,
  runTranslatePipeline,
  runUpdatePipeline,
} from "./core-tools.ts"
import type { Config } from "./types.ts"
import { DEFAULT_CONFIG } from "./types.ts"

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "purify_run",
    description:
      "Step 1. Start a purify session. Translates natural language through AISP to expose ambiguity, " +
      "validates the result, and returns immediately with one of: " +
      "status=ready (call purify_translate next), " +
      "status=needs_clarification (questions returned — collect author answers and call purify_clarify), " +
      "status=has_contradictions (contradictions returned — surface to author and resolve before resubmitting). " +
      "The session accumulates conversation context for prompt caching across all subsequent calls.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The raw specification text to purify",
        },
        context: {
          type: "string",
          description:
            "Optional domain context from purify.context.md. Injected as cached system prompt.",
        },
        config: {
          type: "object",
          description: "Optional pipeline configuration. Defaults: on_low_score / ◊ / true / 2",
          properties: {
            clarification_mode: {
              type: "string",
              enum: ["always", "on_low_score", "never"],
              description:
                "When to generate clarifying questions. " +
                "on_low_score: only when below threshold (default). " +
                "always: whenever below threshold regardless of round. " +
                "never: proceed directly to translate.",
            },
            score_threshold: {
              type: "string",
              enum: ["◊⁺⁺", "◊⁺", "◊", "◊⁻", "⊘"],
              description: "Minimum tier to proceed without clarification (default: ◊ silver)",
            },
            ask_on_contradiction: {
              type: "boolean",
              description: "If true, return has_contradictions instead of proceeding (default: true)",
            },
            max_clarify_rounds: {
              type: "number",
              description: "Maximum clarification rounds before proceeding (default: 2)",
            },
          },
        },
      },
      required: ["text"],
    },
  },
  {
    name: "purify_clarify",
    description:
      "Step 2 (conditional). Submit answers to clarifying questions and re-run validation. " +
      "Call this after purify_run or purify_clarify returns status=needs_clarification. " +
      "The session conversation is updated with answers and a refined AISP. " +
      "Returns the same status variants as purify_run. " +
      "When status=ready, call purify_translate to get the final purified English.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID from the prior purify_run or purify_clarify call",
        },
        answers: {
          type: "array",
          description: "Answers to the clarifying questions",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The clarifying question" },
              answer: { type: "string", description: "The author's answer" },
            },
            required: ["question", "answer"],
          },
        },
      },
      required: ["session_id", "answers"],
    },
  },
  {
    name: "purify_translate",
    description:
      "Step 3. Translate the purified AISP to natural language. " +
      "Call this when purify_run or purify_clarify returns status=ready. " +
      "Uses the full accumulated session conversation as context for faithful translation. " +
      "Returns the purified English text.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID from the prior purify_run or purify_clarify call",
        },
        format: {
          type: "string",
          description:
            'Output format description or example. Use "preserve input format" to match the original. ' +
            "Can specify a mode: formal (tables/steps), narrative (prose), hybrid, sketch, or summary.",
          default: "preserve input format",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "purify_update",
    description:
      "Step 1 (update). Update an existing purified spec by applying a change. " +
      "Seeds a new session from the previous session's conversation, " +
      "appends the change as a new turn, and re-runs the full pipeline. " +
      "Returns the same status variants as purify_run — follow the same " +
      "clarify/translate flow to get the updated purified text.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID from the previous completed purify session",
        },
        change: {
          type: "string",
          description: "Natural language description of the change to apply",
        },
        context: {
          type: "string",
          description: "Optional updated domain context from purify.context.md",
        },
        config: {
          type: "object",
          description: "Optional pipeline configuration for the new session",
          properties: {
            clarification_mode: { type: "string", enum: ["always", "on_low_score", "never"] },
            score_threshold: { type: "string", enum: ["◊⁺⁺", "◊⁺", "◊", "◊⁻", "⊘"] },
            ask_on_contradiction: { type: "boolean" },
            max_clarify_rounds: { type: "number" },
          },
        },
      },
      required: ["session_id", "change"],
    },
  },
  {
    name: "purify_patch",
    description:
      "Patch a section of an existing purified spec without re-running the full pipeline. " +
      "Requires an existing session with aisp_current (i.e., purify_run + purify_translate already completed). " +
      "Sends only the changed section as new tokens; the full AISP is in the system prompt and is prompt-cached. " +
      "Returns a section-level English snippet and the AISP blocks that changed — not the full document. " +
      "Use this instead of purify_update when only a portion of a large spec has changed.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID from a completed purify_run + purify_translate flow",
        },
        section: {
          type: "string",
          description: "The changed section of the specification (English text, not a change description)",
        },
        hint: {
          type: "string",
          description: "Optional: which part of the spec this belongs to (e.g. 'retry rules', 'auth section')",
        },
        format: {
          type: "string",
          description: "Output format for the English snippet. Same values as purify_translate.",
          default: "preserve input format",
        },
      },
      required: ["session_id", "section"],
    },
  },
  {
    name: "purify_init",
    description:
      "Setup (once per project). Reads existing project files (specs, schemas, docs, AISP files) " +
      "and generates the content for purify.context.md — a domain model that improves all subsequent " +
      "purify sessions for this project. Pass the file path to purify_run as the context parameter. " +
      "Run this before your first purify_run for best results.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "Absolute or relative paths to project files to extract context from",
          items: { type: "string" },
        },
      },
      required: ["files"],
    },
  },
]

// ── Server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "purify", version: "2.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (name === "purify_run") {
      const { text, context, config: configInput } = args as {
        text: string
        context?: string
        config?: Partial<Config>
      }
      const config: Config = { ...DEFAULT_CONFIG, ...configInput }
      const result = await runPurifyPipeline(text, context, config, {})
      if (!context) {
        result.context_hint =
          "No context provided. Run purify_init on your project files once to generate purify.context.md, " +
          "then pass its contents as the context parameter for higher-quality output."
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_clarify") {
      const { session_id, answers } = args as {
        session_id: string
        answers: Array<{ question: string; answer: string }>
      }
      const result = await runClarifyPipeline(session_id, answers, {})
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_translate") {
      const { session_id, format = "preserve input format" } = args as {
        session_id: string
        format?: string
      }
      const result = await runTranslatePipeline(session_id, format, {})
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_update") {
      const { session_id, change, context, config: configInput } = args as {
        session_id: string
        change: string
        context?: string
        config?: Partial<Config>
      }
      const config: Config = { ...DEFAULT_CONFIG, ...configInput }
      const result = await runUpdatePipeline(session_id, change, context, config, {})
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_patch") {
      const { session_id, section, hint, format = "preserve input format" } = args as {
        session_id: string
        section: string
        hint?: string
        format?: string
      }
      const result = await runPatchPipeline(session_id, section, hint, format, {})
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }

    if (name === "purify_init") {
      const { files } = args as { files: string[] }
      const result = await initContext(files, {})
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
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
