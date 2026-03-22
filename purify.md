# purify — Specification

## Foundation

The core thesis: AISP translation is a purification process, not a communication format. The purified English output — not the AISP — is the deliverable. The round-trip exists because AISP grammar forces exhaustive enumeration, explicit negation, and typed relationships that fluent English prose does not enforce. Errors hidden by fluent prose become visible after the round-trip.

**purify is a purification tool, not a spec generator:**
- Must never write specs from scratch.
- Must never act as a linter.
- Must never execute AISP.
- Must never block work on low δ.

**The round-trip invariant:** For every prompt *p*, ambiguity(purify(*p*)) < ambiguity(*p*).

**The compilation analogy:** English "NEVER update event tables" can be rationalized past by an agent. The constraint ∀*t* ∈ EventTables: ¬∃update(*t*) has no grammatically valid interpretation that permits an update. AISP constraints are more enforceable than English rules for AI coding agents.

**Validator score is authoritative:** The validator δ takes precedence over the LLM self-reported δ.

**Tier drives agent behavior:**
- tier ∈ {◊⁺⁺, ◊⁺}: Agent proceeds silently. No confirmation required.
- tier ∈ {◊, ◊⁻}: Agent proceeds and confirms assumptions before file changes.
- tier ≡ ⊘: Agent outputs NeedsClarification and does not proceed.

---

## Types

### Quality Tiers

| Symbol | Name | δ Range | Meaning |
|--------|------|---------|---------|
| ⊘ | invalid | δ < 0.20 | Input too thin or contradictory to translate. |
| ◊⁻ | bronze | [0.20, 0.40) | Low semantic density. |
| ◊ | silver | [0.40, 0.60) | Moderate semantic density. |
| ◊⁺ | gold | [0.60, 0.75) | High semantic density. |
| ◊⁺⁺ | platinum | ≥ 0.75 | Very high semantic density. |

### Provider

| Value |
|-------|
| `anthropic` |
| `openai` |

### ModelRole

| Value | Purpose | Anthropic default | OpenAI default |
|-------|---------|-------------------|----------------|
| `purify_model` | Cheap model. English → AISP (constrained grammar task). | `claude-haiku-4-5-20251001` | `gpt-4o-mini` |
| `main_model` | Capable model. AISP → English (requires nuance judgment). | `claude-sonnet-4-6` | `gpt-4o` |

**Override precedence — main model:** `--model` CLI flag > `PURIFY_MODEL` env var > ModelRole default

**Override precedence — cheap model:** `--purify-model` CLI flag > `PURIFY_MODEL_CHEAP` env var > ModelRole default

**Override precedence — provider:** `--provider` CLI flag > `PURIFY_PROVIDER` env var > `anthropic`

### Output Mode

Controls how the AISP intermediate is rendered back to English.

All modes produce plain English output — no AISP notation appears in any mode. Modes differ in depth, structure, and verbosity.

| Mode | Structure | Depth | Audience |
|------|-----------|-------|----------|
| `formal` | Tables, numbered steps, grouped bullets | Maximum — every value, case, and constraint | Expert / spec consumer |
| `narrative` | Connected prose paragraphs, light tables | Full — nothing omitted, prose-first | Developer / student |
| `hybrid` | Prose intro per section + table or list | Full — nothing omitted, structured detail | Technical reader |
| `sketch` | Overview paragraph + bullet list | Reduced — minor detail omitted | Team overview |
| `summary` | Short paragraph + bullets + takeaways | Minimal — key points only | Non-technical audience |

Default mode: `narrative`.

**Override precedence:** `--mode <mode>` or shorthand `--<mode>` flag > `PURIFY_MODE` env var > `narrative`

### InputSource

| Value | Condition |
|-------|-----------|
| `file` | Exactly one positional argument and path exists on disk. |
| `inline` | One or more positional arguments (path does not exist). |
| `stdin` | No positional arguments and stdin is not a TTY. |

### Core Data Types

| Type | Definition |
|------|-----------|
| `Delta` | Real number in [0.00, 1.00]. |
| `Prompt` | Raw English string: task description, spec fragment, constraint list, or requirement set. May be vague, hedged, or incomplete. |
| `AISPIntermediate` | AISP 5.1 document string produced by purify_model. Required blocks: 𝔸header, ⟦Ω⟧, ⟦Σ⟧, ⟦Γ⟧, ⟦Λ⟧, ⟦Ε⟧. Optional: ⟦Χ⟧. Not surfaced to user unless `--verbose`. |

### ValidationResult

| Field | Type | Notes |
|-------|------|-------|
| `valid` | boolean | — |
| `delta` | real | Semantic density δ = (blockScore × 0.4) + (bindingScore × 0.6). |
| `tier` | Tier | — |
| `ambiguity` | real | From aisp-validator WASM kernel. |
| `pure_density` | real | \|AISP_symbols\| ÷ \|non_ws_tokens\|. |

### EvidenceBlock

| Field | Type | Notes |
|-------|------|-------|
| `delta_self` | real (nullable) | LLM self-reported δ from ⟦Ε⟧. |
| `tier_self` | Tier | LLM self-reported τ. |

### Result

| Field | Type | Notes |
|-------|------|-------|
| `tier` | Tier | — |
| `delta_auth` | real | Authoritative δ — validator preferred, self fallback. |
| `delta_self` | real (nullable) | Included for divergence detection. |
| `output` | Output | PurifiedEnglish ∨ NeedsClarification. |

### PurifiedEnglish

Clean markdown string with the following properties:
- No hedge words: never use `typically`, `usually`, `often`, `generally`, `might`, `may`, `could`, `probably`.
- No preamble. Start with the first section heading.
- Invariants rendered as declarative statements. ¬X rendered as "must not" or "never".
- Enumerations fully listed. No "etc." No implied values.
- Code blocks preserved verbatim (except in `sketch` and `summary` modes — see Output Mode).
- No rationale added beyond AISP source.

### NeedsClarification

| Field | Type | Notes |
|-------|------|-------|
| `questions` | string[1..7] | Specific, answerable questions derived from `;; AMBIGUOUS` comments in AISP. Binary or multiple-choice preferred. No open-ended questions. |

### REPL Types

| Type | Definition |
|------|-----------|
| `ConvMessage` | `{ role: "user" \| "assistant", content: string }` |
| `REPLState` | `{ turn: ℕ, messages: ConvMessage[], buffer: string[], cache_size: ℕ, last_delta: real (nullable), last_tier: Tier (nullable) }` |
| `SubmitSignal` | `empty_line`, `eof`, `ctrl_c`, or `exit_cmd` |
| `CacheControl` | `{ type: "ephemeral" }` (Anthropic) or automatic (OpenAI) |

---

## Pipeline — Single-shot Mode

```
purify ≜ λp:Prompt.
  aisp    = step1_to_aisp(p)
  vr      = try(runValidator(aisp))
  ev      = parseEvidence(aisp)
  δ_auth  = vr?.delta ∨ ev.delta_self
  tier    = calcTier(δ_auth)
  english = step2_to_english(aisp, mode)
  Result{ tier, delta_auth:δ_auth, delta_self:ev.delta_self, output:english }
```

### Step 1: English → AISP (`--purify-model`)

The purify_model renders the input in AISP 5.1 formal grammar. An optional `AI_GUIDE.md` may be prepended to the system prompt. Candidates in order:
1. `$AISP_GUIDE` environment variable.
2. `<script_dir>/AI_GUIDE.md`.
3. `$HOME/.config/aisp/AI_GUIDE.md`.

Absence of `AI_GUIDE.md` is not a failure; purify proceeds with built-in symbol reference.

**Skipped** when `--from-aisp` is set — input is treated as AISP directly.

### Step 2: Validation

```
validate ≜ λaisp.
  await AISP.init()          // must precede AISP.validate()
  AISP.validate(aisp)        // → ValidationResult
  calculateSemanticDensity(aisp)
```

Validator failure is non-fatal. If the validator throws, fall back to self-reported δ.

### Step 3: AISP → English (`--model`, `--mode`)

The main_model translates AISP back to English using the system prompt for the selected mode. The system prompt branches on both tier and mode:

- tier ≡ ⊘: Produce NeedsClarification from `;; AMBIGUOUS` comments (same for all modes).
- tier ∈ {◊⁺⁺, ◊⁺, ◊, ◊⁻}: Produce output shaped by the selected mode (see Output Mode).

Mode-specific rendering rules (no AISP notation in any mode):
- `formal`: Thorough structured English. Tables for types and entities, numbered steps for functions, grouped bullets for constraints. Code blocks verbatim.
- `narrative`: Flowing connected prose. Paragraphs per section with connective language. Tables only for compact enumerations. Code blocks verbatim.
- `hybrid`: Prose intro per section followed by a table or list for the details. Code blocks verbatim.
- `sketch`: Short overview paragraph then a bullet list. Minor detail omitted. Code examples as pseudocode or prose description.
- `summary`: Short paragraph + bullet list + key takeaways. No tables, no code blocks. Code examples described in plain words.

### Output Format

```
QUALITY: <tier_symbol> <tier_name> (δ=<delta_auth>, self_δ=<delta_self>)
---
<PurifiedEnglish or NeedsClarification>
```

Omit `self_δ` if delta_self is not available.

---

## Pipeline — REPL Mode (`--repl`)

An interactive session maintaining full conversation history with prompt caching.

### Invariants

- Every user message is purified to AISP before being appended to history (unless `--from-aisp`).
- History is append-only and strictly ordered.
- The system prompt is cached as ephemeral for the full session.
- All previous messages in history are marked `cache_control: ephemeral`; only the current user message is sent plain.
- All exit paths (Ctrl-C, `/exit`, EOF) terminate cleanly.
- On API error: roll back the last user message from history so history remains coherent.
- Buffer overflow (> 1000 lines): reset buffer and prompt retry.

### Loop

```
repl_loop ≜ λ(opts).
  messages = []
  print startup banner to stderr
  for each line from stdin:
    if line ≠ "":
      append line to buffer
    else if buffer is empty:
      continue
    else if len(buffer) > 1000:
      print "⊘ buffer overflow" to stderr; reset buffer
    else:
      input = buffer.join("\n"); buffer = []
      if input == "/exit": break
      aisp    = fromAisp? input : callLLM(purify_model, TO_AISP_SYSTEM, input)
      vr      = try(runValidator(aisp))
      ev      = parseEvidence(aisp)
      δ_auth  = vr?.delta ∨ ev.delta_self
      print quality score to stderr
      messages.push({ role:"user", content:aisp })
      response = callLLMRepl(main_model, REPL_SYSTEM(mode), messages)  // cached
      messages.push({ role:"assistant", content:response })
      print response to stdout
  print "exiting..." to stderr
```

### Prompt Caching (Anthropic)

- System prompt sent as `[{ type: "text", text: REPL_SYSTEM, cache_control: { type: "ephemeral" } }]`.
- All messages except the current (last) user message sent with `cache_control: ephemeral` on their content blocks.
- Result: on each turn, the entire prior conversation is a cache hit.

OpenAI: prompt caching is automatic, no special handling required.

### Output Routing (REPL)

| Content | Stream |
|---------|--------|
| Purified English response | stdout |
| Quality score, status, errors | stderr |
| AISP intermediate (`--verbose`) | stderr |

---

## Translation Rules

### English → AISP

- Every constraint becomes a universal quantifier or explicit negation: ∀expr, ∃expr, ¬expr, or ⇒expr.
- Every enumeration is fully spelled out. No implied values. No "etc."
- Relationships are typed. Both source and target must have explicit types.
- Conditionals use implication: X ⇒ Y, not prose.
- Negations use ¬, ≠, or ∉ explicitly. Never use omission to imply negation.
- Nullable fields marked with `?` suffix.
- Unresolvable ambiguities marked with `;; AMBIGUOUS: <description>`. Score δ low.

### AISP → English

- Translation is lossless. No rationale added. No content dropped.
- Hedge words prohibited: `typically`, `usually`, `often`, `generally`, `might`, `may`, `could`, `probably`.
- No preamble. Start with the first section heading.
- Code blocks preserved verbatim except in `sketch` and `summary` modes.

---

## Validation and Scoring

**Scoring authority:**
- If `runValidator` succeeds: `delta_auth` ≜ `validatorResult.delta`.
- If `runValidator` fails: `delta_auth` ≜ `evidenceBlock.delta_self`.
- If `evidenceBlock.delta_self` is null: tier ≜ ⊘.

**Score divergence:** If |delta_auth − delta_self| > 0.1, both scores appear in the result header. Divergence must not be suppressed.

**Delta to tier:**

| Condition | Tier |
|-----------|------|
| δ is null | ⊘ |
| δ ≥ 0.75 | ◊⁺⁺ |
| δ ≥ 0.60 | ◊⁺ |
| δ ≥ 0.40 | ◊ |
| δ ≥ 0.20 | ◊⁻ |
| otherwise | ⊘ |

---

## CLI

```
purify [options] [file]
purify [options] "inline text"
cat spec.md | purify [options]
purify --repl
```

### Options

| Flag | Description |
|------|-------------|
| `--provider anthropic\|openai` | LLM provider (default: anthropic) |
| `--model <model>` | Main model for AISP → English (default: provider default) |
| `--purify-model <model>` | Cheap model for English → AISP (default: provider default) |
| `--mode formal\|narrative\|hybrid\|sketch\|summary` | Output rendering mode (default: narrative) |
| `--formal` | Shorthand for `--mode formal` |
| `--narrative` | Shorthand for `--mode narrative` |
| `--hybrid` | Shorthand for `--mode hybrid` |
| `--sketch` | Shorthand for `--mode sketch` |
| `--summary` | Shorthand for `--mode summary` |
| `--api-key <key>` | API key (default: env var) |
| `--from-aisp` | Skip step 1 — input is already AISP |
| `--repl` | Interactive session with chat context and prompt caching |
| `--verbose` | Write AISP intermediate and scores to stderr |
| `--help` | Print help |

Unknown `--` flags cause an error and exit with code 1.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `PURIFY_PROVIDER` | Default provider |
| `PURIFY_MODEL` | Default main model |
| `PURIFY_MODEL_CHEAP` | Default cheap model |
| `PURIFY_MODE` | Default output mode |
| `AISP_GUIDE` | Path to AI_GUIDE.md |

### Constraints

- If trimmed input is empty: print help and exit 0.
- If no API key found for the selected provider: write to stderr and exit 1.
- If an unknown `--` flag is encountered: write to stderr and exit 1.
- Every LLM call uses `max_tokens = 8096`.
- Step 1 and Step 2 are sequential. Step 2 must not start before Step 1 completes.
- Verbose output goes to stderr only. Non-verbose runs are stderr-silent.

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

### Missing AI_GUIDE.md

**Problem:** `AI_GUIDE.md` not found in any candidate location.

**Impact:** Translation fidelity may be lower. This is not a failure.

**Fix (optional):** `curl -sL https://raw.githubusercontent.com/bar181/aisp-open-core/main/AI_GUIDE.md > AI_GUIDE.md`

### REPL: API Error During Turn

**Problem:** API call fails after user message has been pushed to history.

**Fix:** Roll back the last user message from `messages[]` before prompting retry. History must remain coherent.

### REPL: Buffer Overflow

**Problem:** User pastes more than 1000 lines.

**Fix:** Reset buffer and `pending`, write `⊘ buffer overflow` to stderr, prompt retry.

---

## Guarantees

- **Purification:** For every prompt *p*, ambiguity(purify(*p*)) < ambiguity(*p*).
- **Round-trip:** purify ≜ (translate_to_english ∘ validate ∘ translate_to_aisp).
- **Not a generator:** purify does not write specs from scratch.
- **Validator authority:** If validation succeeds, validator δ takes precedence over self-reported δ.
- **Tier-driven behavior:** tier ≡ ⊘ ⇒ agent does not proceed.
- **Model split:** Step 1 uses purify_model. Step 2 uses main_model.
- **WASM precondition:** `AISP.validate()` requires prior `AISP.init()`.
- **Guide optional:** purify proceeds even if `AI_GUIDE.md` is absent.
- **Hedge-free:** No hedge words in output.
- **Divergence visible:** Score divergence > 0.1 appears in result header.
- **REPL coherence:** History remains coherent across API errors via rollback.
- **REPL caching:** System prompt and prior conversation are cache hits on every turn after the first.
- **Unknown flags fatal:** Unrecognised `--` flags exit with code 1.
- **Mode default:** Output mode defaults to `narrative` unless overridden.
