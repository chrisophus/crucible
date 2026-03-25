# crucible

**purify** — remove AI slop from technical docs.

AI-assisted specs and requirements sound precise but often aren't. Fluent prose lets vague quantifiers, unstated assumptions, and contradictions slip through — and they stay hidden until someone tries to implement. "Should retry on failure" sounds complete; it isn't. Which failures? How many times? With what backoff?

A crucible purifies metal under heat by forcing impurities to the surface. This tool does the same: it routes your text through AISP 5.1 formal grammar and back to plain English. The grammar has no tolerance for vagueness — every constraint must have an explicit quantifier, every negation must be stated, every enumeration must be complete. What survives the round-trip is unambiguous; what doesn't surfaces the problem before it becomes a bug.

The round-trip invariant: `ambiguity(purify(p)) < ambiguity(p)` for every input `p`.

---

## How it works

1. **English → AISP**: your input is translated into AISP 5.1 formal grammar, which forces every constraint into an explicit quantifier, every enumeration to be fully spelled out, and every negation to be stated. Ambiguities that survive fluent prose become visible here.
2. **Score**: the AISP document is scored for semantic density (δ ∈ [0, 1]) and assigned a quality tier. By default the LLM's self-reported scores are used. Pass `--validate` to run the external WASM validator, or `on_low_score` to use it only as a fallback.
3. **AISP → English**: the document is translated back to plain English using the full conversation as context.

The purified output — not the AISP — is the deliverable.

---

## Surfaces

| Surface | Best for | Setup |
|---------|----------|-------|
| **CLI** | One-shot purification, scripts, shell pipelines | `npm install -g .` |
| **MCP server** | AI-assisted iterative refinement | `purify-mcp` in PATH |
| **`/purify`** | Inline Claude Code command (no install required) | Copy `claude/skills/purify/` into your project's `.claude/skills/` |

---

## Install

```bash
git clone https://github.com/chrisophus/crucible
cd crucible
npm install -g .
```

Requires Node.js ≥ 20.19.

---

## Usage

### CLI

```bash
purify "inline text or requirement"
purify -f spec.md
cat spec.md | purify
purify -f spec.md --suggest           # iterative suggestion mode
purify --repl -c style-guide.md       # interactive REPL with context
```

File input uses `-f` / `--input`. Positional arguments are always literal strings, not paths. Optional: `--feedback` (one-shot author context), `-o` / `--output` (write final English).

Run `purify --help` for the full option list.

### MCP server (for Claude Code, Claude Desktop, Cursor, opencode, etc.)

Add to your MCP config:

```json
{
  "mcpServers": {
    "purify": {
      "command": "purify-mcp",
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Run `purify-mcp --help` for full configuration instructions.

---

## MCP Tools

Four tools implement the session pipeline. Sessions accumulate conversation for prompt caching and context continuity.

### `purify_run` — start a session

```json
{
  "text": "The retry logic should back off exponentially...",
  "context": "<contents of purify.context.md>",
  "config": {
    "contradiction_detection": "on_low_score",
    "external_validation": "never",
    "score_threshold": "◊"
  }
}
```

Returns:
- `status=ready` → call `purify_translate`
- `status=has_contradictions` + `contradictions` → surface to author, resubmit

### `purify_translate` — get purified English

```json
{ "session_id": "...", "format": "narrative" }
```

Returns `{ "purified": "...", "session_id": "..." }`.

### `purify_update` — apply a change to an existing session

```json
{
  "session_id": "...",
  "change": "Add a maximum of 5 retries before failing permanently"
}
```

Seeds a new session from the previous conversation and re-runs the pipeline.

### `purify_patch` — patch a single section

```json
{ "session_id": "...", "section": "<changed section text>" }
```

Sends only the changed section as new tokens. The full AISP is in the system prompt and is prompt-cached. Returns a section-level English snippet without re-running the full pipeline.

### `purify_init` — generate purify.context.md

```json
{ "files": ["./spec.md", "./schema.ts", "./ARCHITECTURE.md"] }
```

Returns `{ "context_file": "...", "summary": "..." }`. Save `context_file` as `purify.context.md` in your project root and pass its contents as the `context` parameter on future `purify_run` calls.

---

## Agent workflow

```
1. Load purify.context.md (warn once if absent)
2. purify_run({text, context}) → result
3. If has_contradictions: surface to author, resolve, resubmit
4. If ready: purify_translate({session_id, format}) → purified
5. Use purified as the working document
```

---

## Output modes

All modes produce plain English — no AISP notation appears in any output.

| Mode | Output style |
|------|-------------|
| `formal` | Translate the AISP to English (default) |
| `input` | Match the style and format of the original input |
| `narrative` | Flowing connected prose |
| `hybrid` | Prose intro per section + tables or lists for detail |
| `sketch` | Overview paragraph + bullet list of key points |
| `summary` | Short paragraph + bullet takeaways |

```bash
purify --summary -f spec.md
purify --narrative -f spec.md
purify --mode input -f spec.md
purify --mode sketch "add a retry mechanism with exponential backoff"
```

---

## Quality tiers

| Symbol | Name | δ range | Meaning |
|--------|------|---------|---------|
| ◊⁺⁺ | platinum | ≥ 0.75 | Very high semantic density |
| ◊⁺ | gold | [0.60, 0.75) | High semantic density |
| ◊ | silver | [0.40, 0.60) | Moderate semantic density |
| ◊⁻ | bronze | [0.20, 0.40) | Low semantic density |
| ⊘ | invalid | < 0.20 | Too thin or contradictory |

CLI output format:

```
QUALITY: ◊⁺⁺ platinum (δ=0.85, φ=88)
---
<purified English>
```

---

## CLI Options

```
--repl           interactive session with prompt caching
                 REPL commands: /context <path>  /patch  /exit
--suggest        show purified version then suggest changes to the original
--input, -f      read specification from file
--context, -c    add reference context file (repeatable)
--feedback       one-shot author context; quote for spaces
--output, -o     write final English to file
--mode           formal|input|narrative|hybrid|sketch|summary  (default: formal)
--formal / --narrative / --hybrid / --sketch / --summary  shorthand mode flags
--provider       anthropic | openai               (default: anthropic)
--model          main model (AISP → English)      (default: claude-sonnet-4-6)
--purify-model   cheap model (En → AISP)          (default: claude-haiku-4-5-20251001)
--api-key        API key                          (default: env var)
--from-aisp      skip step 1 — input is already AISP
--contradictions    always run LLM contradiction detection (slower, more thorough)
--no-contradictions skip contradiction detection entirely
                    default: run only when score is below threshold
--validate          always run external WASM validator for scoring
--no-validate       skip external validator; use LLM self-reported scores only (default)
--verbose        write AISP intermediate and scores to stderr
--debug          log every LLM request and response summary to stderr
--very-verbose   log full request/response content to stderr (implies --debug)
--version, -v
--help, -h
```

## Environment variables

```
ANTHROPIC_API_KEY   OPENAI_API_KEY
PURIFY_PROVIDER     PURIFY_MODEL    PURIFY_MODEL_CHEAP    PURIFY_MODE
```

---

## Providers

Works with Anthropic (default) and OpenAI. Set the appropriate API key and pass `--provider openai` to switch.

---

## Built on AISP 5.1

crucible uses [AISP 5.1 (AI Symbolic Protocol)](https://github.com/bar181/aisp-open-core) as its intermediate representation. AISP was created by [Bradley Ross (@bar181)](https://github.com/bar181).

- [Full spec (AI_GUIDE.md)](https://github.com/bar181/aisp-open-core/blob/main/AI_GUIDE.md)
- [Introduction (HUMAN_GUIDE.md)](https://github.com/bar181/aisp-open-core/blob/main/HUMAN_GUIDE.md)
- [aisp-validator](https://www.npmjs.com/package/aisp-validator) — the WASM validator used for scoring

---

## License

MIT
