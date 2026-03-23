# purify — Specification

𝔸1.0.purify-mcp@2026-03-23

---

## Foundation

The core thesis: AISP translation is a purification process, not a communication format. The purified English output — not the AISP — is the deliverable. The round-trip exists because AISP grammar forces exhaustive enumeration, explicit negation, and typed relationships that fluent English prose does not enforce. Errors hidden by fluent prose become visible after the round-trip.

**purify is a purification tool, not a spec generator:**
- Must never write specs from scratch.
- Must never act as a linter.
- Must never execute AISP.
- Must never block work on low δ.

**The round-trip invariant:** For every prompt *p*, ambiguity(purify(*p*)) < ambiguity(*p*).

**Validator score is authoritative:** The external validator δ takes precedence over the LLM self-reported δ. LLM scores are never trusted.

**Conversation accumulates:** Every call within a session appends turns to the conversation. Turns are never replaced.

**Primary artifact:** The purified English output is the deliverable. AISP is an intermediate only.

---

## Pipeline

```
Pipeline ≜ Purify ⇒ Validate ⇒ (Clarify*) ⇒ Translate
```

| Phase | Who | Input → Output |
|-------|-----|----------------|
| Phase 1: Purify | LLM (cheap model) | RawText → AISPDoc |
| Phase 2: Validate | External validator | AISPDoc → Scores ∧ Contradictions ∧ Gaps |
| Phase 3: Branch | Server | ValidationResult → Questions \| proceed |
| Phase 3a: Generate questions | LLM (main model) | ValidationResult → Question[] |
| Phase 3b: Incorporate answers | LLM (main model) | Answers → AISPDoc' |
| Phase 4: Translate | LLM (main model) | Conversation → PurifiedEnglish |

### Phase 1: Purify

The LLM (cheap model) translates raw text to AISP 5.1. The user turn contains the raw text prefixed with the translation instruction. The AISP is stored as `aisp_current` and appended to the session conversation as an assistant turn.

### Phase 2: Validate — external validator, no LLM

The external validator (WASM) computes scores. Contradictions are detected as part of validation. Gaps are derived from low scores and validator findings. LLM scores are never trusted.

```
ValidationResult ≜ ⟨scores: Scores, contradictions: Contradiction[], gaps: Gap[]⟩
Scores ≜ ⟨delta: ℝ[0,1], phi: Fin(101), tau: QualityTier⟩
```

### Phase 3: Branch

```
case[
  contradictions ≢ ∅ ∧ config.ask_on_contradiction
    → return status=has_contradictions,

  tau < score_threshold ∧ clarification_mode = never
    → proceed_to_phase4,

  tau < score_threshold ∧ clarification_mode ∈ {always, on_low_score} ∧ round < max_clarify_rounds
    → Phase3a: generate questions → return status=needs_clarification,

  tau ≥ score_threshold ∨ round ≥ max_clarify_rounds
    → proceed_to_phase4 → return status=ready
]
```

### Phase 3a: Generate questions

LLM generates clarifying questions using the accumulated conversation + a user turn containing the validation summary and question instruction. Questions and the request turn are appended to the session.

### Phase 3b: Incorporate answers

The author's answers are appended as a user turn. The LLM generates a refined AISP as the assistant response. `aisp_current` is updated. `round` is incremented. Then Phase 2 → Phase 3 re-run.

### Phase 4: Translate

The LLM (main model) receives the full accumulated conversation plus a user turn containing the output format and translate instruction. Returns purified English. No rationale added beyond AISP source.

---

## Session

The server is stateful within a session and stateless across sessions.

```
Session ≜ ⟨
  id          : UUID,
  systemPrompt: string,       -- domain context + AISP spec; cached
  messages    : ConvMessage[], -- user/assistant turns only; append-only
  config      : Config,
  aisp_current: AISPDoc?,
  round       : ℕ
⟩
```

Sessions expire after 30 minutes of inactivity.

### Config

```
Config ≜ ⟨
  clarification_mode  : "always" | "on_low_score" | "never",
  score_threshold     : QualityTier,
  ask_on_contradiction: boolean,
  max_clarify_rounds  : ℕ
⟩
DefaultConfig ≜ ⟨"on_low_score", ◊, true, 2⟩
```

| Field | Default | Meaning |
|-------|---------|---------|
| `clarification_mode` | `on_low_score` | When to ask questions |
| `score_threshold` | `◊` (silver) | Minimum tier to proceed without questions |
| `ask_on_contradiction` | `true` | Return has_contradictions before proceeding |
| `max_clarify_rounds` | `2` | Max answer rounds before proceeding anyway |

### Conversation structure

```
[
  SystemPrompt,           -- AISP spec + domain context; cached for session
  PurifyTurn,             -- user: "Translate to AISP...\n\n<raw text>"
  AISPTurn,               -- assistant: AISP v1
  (QuestionRequestTurn,   -- user: validation summary + question instruction
   QuestionsTurn,         -- assistant: JSON question array
   AnswersTurn,           -- user: Q&A pairs + refine instruction
   RefinedAISPTurn)*,     -- assistant: AISP vN
  TranslateTurn,          -- user: format + translate instruction
  PurifiedTurn            -- assistant: purified English
]
```

### Prompt caching

The system prompt (domain context + AISP spec) is sent with `cache_control: ephemeral` on every call. Subsequent user/assistant turns are appended incrementally, so token cost grows only by the new turn.

---

## MCP Server Tools

Five tools. Provider and model are resolved from environment variables.

### `purify_run`

Starts a session, runs Phase 1 → Phase 3. Returns immediately.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✓ | Raw specification text |
| `context` | string | — | Domain context from `purify.context.md` |
| `config` | Config | — | Pipeline config (see Config above) |

| Output field | When present |
|-------------|--------------|
| `session_id` | Always |
| `status` | Always: `ready` \| `needs_clarification` \| `has_contradictions` |
| `questions` | When `status=needs_clarification` |
| `contradictions` | When `status=has_contradictions` |

**Status flow:**
- `needs_clarification` → collect author answers → call `purify_clarify`
- `has_contradictions` → surface to author → resolve → resubmit `purify_run`
- `ready` → call `purify_translate`

### `purify_clarify`

Submits answers to questions, re-runs Phase 3b → Phase 2 → Phase 3.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | UUID | ✓ | From prior `purify_run` or `purify_clarify` |
| `answers` | `{question, answer}[]` | ✓ | Answers to the returned questions |

Output: same as `purify_run`. May return more questions if still below threshold and rounds remain. Returns `ready` when threshold met or max rounds reached.

### `purify_translate`

Runs Phase 4 using the full accumulated session conversation.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | UUID | ✓ | From prior `purify_run` or `purify_clarify` with `status=ready` |
| `format` | string | — | Output format description. Default: `"preserve input format"` |

Output: `{ purified: string, session_id: UUID }`.

The `format` parameter can describe a mode (`formal`, `narrative`, `hybrid`, `sketch`, `summary`) or give a format example or simply say `"preserve input format"`.

### `purify_update`

Starts a new session seeded from a previous session's conversation. Appends the change as a new turn, re-runs the full pipeline.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | UUID | ✓ | Previous completed session to seed from |
| `change` | string | ✓ | Natural language description of the change |
| `context` | string | — | Updated domain context |
| `config` | Config | — | Pipeline config for the new session |

Output: same as `purify_run` (new `session_id`). Follow the same clarify/translate flow.

### `purify_init`

One-time project setup. Reads existing files and generates `purify.context.md`.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | string[] | ✓ | File paths to extract domain context from |

Output: `{ context_file: string, summary: string }`. Save `context_file` as `purify.context.md` in the project root. Pass its contents as the `context` parameter on future `purify_run` calls.

---

## Agent Skill

### Trigger

The agent skill activates when the author is writing:
- A specification, requirement, or design decision
- An API contract or PR description
- Content that feels ambiguous
- Any content where the author requests purification

### Workflow

```
Step 1: Load purify.context.md (warn once if absent, proceed without)
Step 2: purify_run({text, context, config}) → result
Step 3: if result.status == has_contradictions:
          show contradictions to author
          collect resolutions
          update input and resubmit purify_run
Step 4: if result.status == needs_clarification:
          show questions to author
          collect answers
          purify_clarify({session_id, answers}) → result
          goto Step 3
Step 5: if result.status == ready:
          purify_translate({session_id, format}) → purified
Step 6: use purified as the working document
```

### Update workflow

```
Step 1: Load purify.context.md (proceed without if absent)
Step 2: purify_update({session_id, change, context}) → result
Step 3: Handle same as Workflow Steps 3–6
```

### Agent visibility

| Visible to agent | Opaque to agent |
|-----------------|----------------|
| `purified` English | AISP intermediate |
| `questions` | Scores and validation internals |
| `contradictions` | Conversation history |
| `status` | — |
| `session_id` | — |

---

## Context File

```
ContextFile     ≜ "purify.context.md"
ContextLocation ≜ project_root ∨ nearest_ancestor
StaleThreshold  ≜ 30 days
```

- If `purify.context.md` is not found: warn once and proceed without it.
- If `purify.context.md` is older than 30 days: warn and suggest running `purify_init`.
- If present: pass its contents as the `context` parameter to `purify_run`.

---

## Types

### Quality Tiers

| Symbol | Name | δ Range | Meaning |
|--------|------|---------|---------|
| ⊘ | invalid | δ < 0.20 | Input too thin or contradictory. |
| ◊⁻ | bronze | [0.20, 0.40) | Low semantic density. |
| ◊ | silver | [0.40, 0.60) | Moderate semantic density. |
| ◊⁺ | gold | [0.60, 0.75) | High semantic density. |
| ◊⁺⁺ | platinum | ≥ 0.75 | Very high semantic density. |

Combined tier (MCP tools use both δ and φ):

| Tier | δ | φ |
|------|---|---|
| ◊⁺⁺ | ≥ 0.75 | ≥ 95 |
| ◊⁺ | ≥ 0.60 | ≥ 80 |
| ◊ | ≥ 0.40 | ≥ 65 |
| ◊⁻ | ≥ 0.20 | ≥ 40 |
| ⊘ | otherwise | — |

### PipelineStatus

| Value | Meaning |
|-------|---------|
| `ready` | Call `purify_translate` next |
| `needs_clarification` | Collect answers, call `purify_clarify` |
| `has_contradictions` | Surface to author, resolve, resubmit |
| `complete` | Reserved for future use |

### ClarificationMode

| Value | Behavior |
|-------|---------|
| `on_low_score` | Ask questions when τ < threshold (default) |
| `always` | Ask questions when τ < threshold regardless of prior rounds |
| `never` | Proceed to Phase 4 without asking questions |

### Contradiction kinds

| Kind | Description |
|------|-------------|
| `unsatisfiable_conjunction` | A rule and its direct negation both asserted (A ∧ ¬A) |
| `unreachable_state` | A state declared but no transition leads to it |
| `conflicting_write_authority` | Two sources unconditionally own the same field |
| `violated_uniqueness` | A uniqueness constraint conflicts with a multiplicity rule |

### Gap signals

| Signal | Meaning |
|--------|---------|
| `low_delta` | Semantic density below threshold |
| `missing_block` | Required AISP block absent |
| `sparse_rules` | Rule coverage too thin |
| `unresolved_type` | Type used but not defined |
| `conflicting_authority` | Two sources conditionally own the same field |

---

## Errors

| Error | Condition | Response |
|-------|-----------|----------|
| `ε_no_context` | `purify.context.md` not found | Warn once, proceed |
| `ε_stale_context` | Context older than 30 days | Warn, suggest `purify_init` |
| `ε_contradiction` | Contradictions found + `ask_on_contradiction=true` | Return `has_contradictions` |
| `ε_low_score` | τ < threshold + mode ∈ {always, on_low_score} | Return `needs_clarification` |
| `ε_max_rounds` | `round ≥ max_clarify_rounds` | Proceed to translate, warn |
| `ε_expired_session` | `session_id` not in active sessions | Return error, suggest rerun |
| `ε_no_format` | `format` not provided | Default: `"preserve input format"` |

---

## CLI (single-shot and REPL)

The CLI provides direct access to the purification pipeline without session management.

```
purify [options] [file]
purify [options] "inline text"
cat spec.md | purify [options]
purify --repl
```

### CLI Pipeline

```
purify ≜ λp:Prompt.
  aisp    = step1_to_aisp(p)        -- cheap model, English → AISP
  vr      = try(runValidator(aisp))  -- WASM validator
  ev      = parseEvidence(aisp)      -- self-reported fallback
  δ_auth  = vr?.delta ∨ ev.delta_self
  tier    = calcTier(δ_auth)
  english = step2_to_english(aisp, mode)  -- main model, AISP → English
  Result{ tier, delta_auth:δ_auth, delta_self:ev.delta_self, output:english }
```

### Options

| Flag | Description |
|------|-------------|
| `--provider anthropic\|openai` | LLM provider (default: anthropic) |
| `--model <model>` | Main model for AISP → English |
| `--purify-model <model>` | Cheap model for English → AISP |
| `--mode formal\|narrative\|hybrid\|sketch\|summary` | Output mode (default: narrative) |
| `--mode-file <path>` | Path to a skill markdown file |
| `--formal` / `--narrative` / `--hybrid` / `--sketch` / `--summary` | Shorthand mode flags |
| `--api-key <key>` | API key |
| `--from-aisp` | Skip step 1 — input is already AISP |
| `--repl` | Interactive session with prompt caching |
| `--verbose` | Write AISP intermediate and scores to stderr |
| `--help` | Print help |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `PURIFY_PROVIDER` | Default provider |
| `PURIFY_MODEL` | Default main model |
| `PURIFY_MODEL_CHEAP` | Default cheap model |
| `PURIFY_MODE` | Default output mode |
| `PURIFY_MODE_FILE` | Path to mode skill file |
| `AISP_GUIDE` | Path to AI_GUIDE.md |

### Output Format (CLI)

```
QUALITY: <tier_symbol> <tier_name> (δ=<delta_auth>, self_δ=<delta_self>)
---
<PurifiedEnglish or NeedsClarification>
```

### CLI Output Modes

| Mode | Structure | Audience |
|------|-----------|----------|
| `narrative` | Flowing prose (default) | Developer / student |
| `formal` | Tables, numbered steps, bullets | Expert / spec consumer |
| `hybrid` | Prose intro + table or list | Technical reader |
| `sketch` | Overview + bullet list | Team overview |
| `summary` | Short paragraph + bullets + takeaways | Non-technical audience |

### REPL Mode

An interactive session with accumulated conversation history and prompt caching.

**Invariants:**
- Every user message is purified to AISP before appending to history.
- History is append-only and strictly ordered.
- System prompt is cached as ephemeral for the full session.
- All prior messages are marked `cache_control: ephemeral`; only the current user message is plain.
- On API error: roll back the last user message so history remains coherent.
- Buffer overflow (> 1000 lines): reset buffer, prompt retry.

---

## Scoring

**Scoring authority:**
- If `runValidator` succeeds: `delta_auth` ≜ `validatorResult.delta`.
- If `runValidator` fails: `delta_auth` ≜ `evidenceBlock.delta_self`.
- If `evidenceBlock.delta_self` is null: tier ≜ ⊘.

**Score divergence:** If |delta_auth − delta_self| > 0.1, both scores appear in the header.

**Delta → tier (CLI):**

| Condition | Tier |
|-----------|------|
| δ is null | ⊘ |
| δ ≥ 0.75 | ◊⁺⁺ |
| δ ≥ 0.60 | ◊⁺ |
| δ ≥ 0.40 | ◊ |
| δ ≥ 0.20 | ◊⁻ |
| otherwise | ⊘ |

**Delta + phi → tier (MCP tools):** See Quality Tiers table above.

---

## Guarantees

- **Purification:** For every prompt *p*, ambiguity(purify(*p*)) < ambiguity(*p*).
- **External validator authority:** Validator δ takes precedence over self-reported δ. LLM scores are never trusted.
- **Conversation accumulation:** Turns append; never replaced within a session.
- **Prompt caching:** System prompt is a cache hit on every call after the first in a session.
- **Session statefulness:** Server is stateful within a session, stateless across sessions.
- **Session expiry:** Sessions expire after 30 minutes of inactivity.
- **Phase 4 context:** Translate uses the full accumulated conversation as context.
- **Not a generator:** purify does not write specs from scratch.
- **WASM precondition:** `AISP.validate()` requires prior `AISP.init()`.
- **Guide optional:** purify proceeds even if `AI_GUIDE.md` is absent.
- **Hedge-free:** No hedge words in output.
- **Mode default:** CLI output mode defaults to `narrative` unless overridden.

---

## Errors and Gotchas

### WASM Initialization

**Problem:** Calling `AISP.validate()` without prior `AISP.init()` raises `TypeError: "Cannot read properties of undefined (reading '_instance')"`.

**Fix:** Always `await AISP.init()` before the first `AISP.validate()` call. The validator lazy-initializes and is non-fatal on failure.

### ESM-Only Package

**Problem:** `require("aisp-validator")` in a CommonJS project raises `"Cannot find module aisp-validator/src/index.cjs"`.

**Fix:** Set `package.json` `type: "module"` and use the `tsx` runner.

### aisp-converter Hardcoded Score

**Problem:** `aisp-converter.full_tier` always emits δ ≜ 0.82 and τ ≜ ◊⁺⁺ regardless of actual quality.

**Fix:** Do not use `aisp-converter` for quality assessment. Use `aisp-validator` instead.

### Score Divergence

**Problem:** |delta_auth − delta_self| > 0.15 indicates the LLM over-reported quality.

**Fix:** Surface both scores in the header. Do not suppress divergence.

### Expired Session

**Problem:** `session_id` passed to `purify_clarify`, `purify_translate`, or `purify_update` is no longer in the session store.

**Fix:** Sessions expire after 30 minutes of inactivity. Start a new session with `purify_run`. If updating a previously completed session, ensure `purify_update` is called while the original session is still active, or re-run `purify_run` from scratch.

### REPL: API Error During Turn

**Problem:** API call fails after user message has been pushed to history.

**Fix:** Roll back the last user message from `messages[]` before prompting retry. History must remain coherent.
