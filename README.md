# crucible

**purify** — AISP round-trip spec purification.

A crucible purifies metal under heat by forcing impurities to the surface. This tool does the same for written specs: it routes your input through AISP 5.1 formal grammar and back to English, surfacing hidden ambiguity in the process.

The round-trip invariant: `ambiguity(purify(p)) < ambiguity(p)` for every input `p`.

---

## How it works

1. **English → AISP** (cheap model): your input is translated into AISP 5.1 formal grammar, which forces every constraint into an explicit quantifier, every enumeration to be fully spelled out, and every negation to be explicit. Ambiguities that survive fluent English prose become visible here.
2. **Validate**: an independent WASM validator scores the AISP document (δ ∈ [0, 1]) and assigns a quality tier. The validator score is authoritative — LLM self-reported scores are never trusted.
3. **Clarify** *(optional)*: if the score is below threshold, the model generates specific questions for the author. Answers are incorporated and the AISP is refined.
4. **AISP → English** (main model): the formal document is translated back to plain English using the full conversation as context.

The purified output — not the AISP — is the deliverable.

---

## Install

```bash
git clone https://github.com/chrisophus/crucible
cd crucible
./install.sh
```

Requires Node.js. Make sure `~/.local/bin` is in your `PATH`.

---

## Usage

### CLI

```bash
purify "inline text or requirement"
purify -f spec.md
cat spec.md | purify
purify --repl
purify --repl -f spec.md
```

File input uses `-f` / `--input`. Positional arguments are always literal strings, not paths. Optional: `--feedback` (one-shot author context), `-o` / `--output` (write final English).

### MCP server (for Claude Desktop, Cursor, opencode, etc.)

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

---

## MCP Tools (v3 session-based pipeline)

Five tools implement the session pipeline. Sessions accumulate conversation for prompt caching and context continuity.

### `purify_run` — start a session

```json
{
  "text": "The retry logic should back off exponentially...",
  "context": "<contents of purify.context.md>",
  "config": { "clarification_mode": "on_low_score", "score_threshold": "◊" }
}
```

Returns:
- `status=ready` → call `purify_translate`
- `status=needs_clarification` + `questions` → collect answers, call `purify_clarify`
- `status=has_contradictions` + `contradictions` → surface to author, resubmit

### `purify_clarify` — submit answers

```json
{
  "session_id": "...",
  "answers": [
    { "question": "Should retries apply to all error types?", "answer": "Only 5xx errors" }
  ]
}
```

Returns the same status variants as `purify_run`.

### `purify_translate` — get purified English

```json
{ "session_id": "...", "format": "preserve input format" }
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

### `purify_init` — generate purify.context.md

```json
{ "files": ["./spec.md", "./schema.ts", "./ARCHITECTURE.md"] }
```

Returns `{ "context_file": "...", "summary": "..." }`. Save `context_file` as `purify.context.md` in your project root and pass its contents as the `context` parameter on future `purify_run` calls.

---

## Agent workflow

When purifying a spec the agent follows this flow:

```
1. Load purify.context.md (warn once if absent)
2. purify_run({text, context}) → result
3. If has_contradictions: surface to author, resolve, resubmit
4. If needs_clarification: show questions, collect answers, purify_clarify → goto 3
5. If ready: purify_translate({session_id, format}) → purified
6. Use purified as the working document
```

---

## CLI Output modes

All modes produce plain English — no AISP notation appears in any output.

| Mode | Style | Audience |
|------|-------|----------|
| `narrative` | Flowing connected prose (default) | Developer / student |
| `formal` | Tables, numbered steps, grouped bullets | Expert / spec consumer |
| `hybrid` | Prose intro per section + structured list | Technical reader |
| `sketch` | Overview paragraph + bullet list | Team overview |
| `summary` | Short paragraph + bullets + takeaways | Non-technical audience |

```bash
purify --summary "add a retry mechanism with exponential backoff"
purify --formal spec.md
purify --mode sketch requirements.txt
```

---

## Quality tiers

| Symbol | Name | δ range | Meaning |
|--------|------|---------|---------|
| ◊⁺⁺ | platinum | ≥ 0.75 | Very high semantic density |
| ◊⁺ | gold | [0.60, 0.75) | High semantic density |
| ◊ | silver | [0.40, 0.60) | Moderate semantic density |
| ◊⁻ | bronze | [0.20, 0.40) | Low semantic density |
| ⊘ | invalid | < 0.20 | Too thin or contradictory — clarification needed |

CLI output format:

```
QUALITY: ◊⁺⁺ platinum (δ=0.91, self_δ=0.85)
---
<purified English>
```

---

## CLI Options

```
--provider   anthropic | openai               (default: anthropic)
--model      main model (AISP → English)      (default: claude-sonnet-4-6)
--purify-model  cheap model (En → AISP)       (default: claude-haiku-4-5-20251001)
--mode       formal|narrative|hybrid|sketch|summary  (default: narrative)
--formal / --narrative / --hybrid / --sketch / --summary   shorthand mode flags
--api-key    API key                          (default: env var)
--from-aisp  skip step 1 — input is already AISP
--repl       interactive session with prompt caching
--verbose    write AISP intermediate and scores to stderr
--help
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
