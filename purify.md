QUALITY: ◊⁺⁺ platinum (δ=1.00, self_δ=0.82)
---
# purify Tool — Specification

## Foundation

The core thesis: AISP translation is a purification process, not a communication format. The purified English output — not the AISP — is the deliverable. The round-trip exists because AISP grammar forces exhaustive enumeration, explicit negation, and typed relationships that fluent English prose does not enforce. Errors hidden by fluent prose become visible after the round-trip.

**purify is a purification tool, not a spec generator:**
- Must never write specs from scratch.
- Must never act as a linter.
- Must never execute AISP.
- Must never block work on low δ.

**purify is a two-step round-trip:**
For every prompt *p*, purify(*p*) ≜ (translate_to_english ∘ validate ∘ translate_to_aisp)(*p*)

**The round-trip invariant:**
The ambiguity of the purified output must be less than the ambiguity of the input.

**The compilation analogy:**
English "NEVER update event tables" can be rationalized past by an agent. The constraint ∀*t* ∈ EventTables: ¬∃update(*t*) has no grammatically valid interpretation that permits an update. AISP constraints are more enforceable than English rules for AI coding agents.

**Validator score is authoritative:**
The validator δ must take precedence over the LLM self-reported δ.

**Tier drives agent behavior:**
- tier ∈ {◊⁺⁺, ◊⁺}: Agent proceeds with purified English. No confirmation required.
- tier ∈ {◊, ◊⁻}: Agent proceeds with purified English and confirms assumptions before file changes.
- tier ≡ ⊘: Agent outputs NeedsClarification and does not proceed.

Ambiguity must be less than 0.02.

---

## Types

### Tier

| Value | Name | Range | Meaning |
|-------|------|-------|---------|
| ⊘ | invalid | — | Input too thin or contradictory to translate. |
| ◊⁻ | bronze | [0.20, 0.40) | Low semantic density. |
| ◊ | silver | [0.40, 0.60) | Moderate semantic density. |
| ◊⁺ | gold | [0.60, 0.75) | High semantic density. |
| ◊⁺⁺ | platinum | ≥ 0.75 | Very high semantic density. |

### Provider

| Value |
|-------|
| anthropic |
| openai |

### ModelRole

| Value | Purpose |
|-------|---------|
| purify_model | Cheap model. English → AISP (constrained grammar task). Anthropic default: claude-haiku-4-5-20251001. OpenAI default: gpt-4o-mini. |
| main_model | Capable model. AISP → English (requires nuance judgment). Anthropic default: claude-sonnet-4-6. OpenAI default: gpt-4o. |

### InputSource

| Value |
|-------|
| inline |
| file |
| stdin |

### Prompt

A string representing raw English: a task description, spec fragment, constraint list, or requirement set. May be vague, hedged, or incomplete. purify surface-treats all of these identically.

### AISPIntermediate

A string representing the AISP translation produced by purify_model. Must contain blocks: 𝔸header, ⟦Ω⟧, ⟦Σ⟧, ⟦Γ⟧, ⟦Λ⟧, ⟦Ε⟧. Optional block: ⟦Χ⟧. Not surfaced to the user unless --verbose.

### ValidationResult

| Field | Type | Notes |
|-------|------|-------|
| valid | boolean | — |
| delta | real | Semantic density δ = (blockScore × 0.4) + (bindingScore × 0.6). |
| tier | Tier | — |
| ambiguity | real | From aisp-validator WASM kernel. |
| pure_density | real | \|AISP_symbols\| ÷ \|non_ws_tokens\|. |

### EvidenceBlock

| Field | Type | Notes |
|-------|------|-------|
| delta_self | real | LLM self-reported δ from ⟦Ε⟧. |
| tier_self | Tier | LLM self-reported τ. |

### Result

| Field | Type | Notes |
|-------|------|-------|
| tier | Tier | — |
| delta_auth | real | Authoritative δ — validator preferred, self fallback. |
| delta_self | real | nullable. Included for divergence detection. |
| output | Output | PurifiedEnglish ∨ NeedsClarification. |

### PurifiedEnglish

A string in clean markdown format with the following properties:
- No hedge words.
- No preamble.
- Invariants rendered as declarative statements. ¬X rendered as "must not" or "never".
- Enumerations fully listed. No "etc." No implied values.
- Code blocks preserved verbatim.
- No rationale added beyond AISP source.

### NeedsClarification

| Field | Type | Notes |
|-------|------|-------|
| questions | string[1..7] | Specific, answerable questions derived from ;; AMBIGUOUS comments in AISP. Binary or multiple-choice preferred. No open-ended questions. |

---

## Translation Rules

### English → AISP (purify_model)

- Every constraint becomes a universal quantifier or explicit negation. Constraints must be rendered as ∀expr, ∃expr, ¬expr, or ⇒expr.
- Every enumeration is fully spelled out. No implied values.
- Relationships are typed. Both source and target must have explicit types.
- Conditionals use implication, not prose. Render as X ⇒ Y, not as English conditional text.
- Negations use ¬, ≠, or ∉ explicitly. Never use omission to imply negation.
- Nullable fields must be marked with ? suffix.
- Unresolvable ambiguities must be marked with ;; AMBIGUOUS: <description>.

### AISP → English (main_model)

Translation is lossless. No rationale added. No content dropped. Semantic content of AISP must appear in output.

Hedge words are prohibited in output. The following words must never appear: typically, usually, often, generally, might, may, could, probably.

Code blocks must be preserved verbatim.

---

## Validation and Scoring

**Validator takes precedence over self-report:**
If validation succeeds, result.delta_auth ≜ result.validation.delta.
If validation fails, result.delta_auth ≜ result.evidence.delta_self.

**Score divergence is surfaced:**
If |result.delta_auth - result.evidence.delta_self| > 0.1, both scores must appear in the result header. Do not suppress divergence.

---

## Tier-to-Behavior Mapping

| Tier | Behavior |
|------|----------|
| ◊⁺⁺, ◊⁺ | Output purified English. Agent proceeds silently. No confirmation required. |
| ◊, ◊⁻ | Output purified English. Agent must confirm assumptions before file changes. |
| ⊘ | Output NeedsClarification. Agent does not proceed. |

---

## Pipeline

### Step 1: English → AISP

```
step1_to_aisp ≜ λp:Prompt.
  let guide  = load_guide(script_dir)
  let system = guide? ∘ TO_AISP_SYSTEM : TO_AISP_SYSTEM
  llm_call(purify_model, system, p): AISPIntermediate
```

The purify_model is a cheap model. It is tasked with rendering the input prompt in AISP formal grammar.

An optional AI_GUIDE.md file may be loaded from:
1. The environment variable AISP_GUIDE.
2. script_dir/AI_GUIDE.md.
3. home()/.config/aisp/AI_GUIDE.md.

If found, it is prepended to the system prompt. If absent, purify proceeds with built-in symbol reference. The absence of AI_GUIDE.md is not a failure.

### Step 2: Validation

```
validate ≜ λaisp:AISPIntermediate.
  await(AISP.init())
  AISP.validate(aisp): ValidationResult
```

Validation must call AISP.init() before AISP.validate(). Calling AISP.validate() without prior initialization raises TypeError.

### Step 3: AISP → English or Clarification

```
step2_to_english ≜ λ(aisp:AISPIntermediate, tier:Tier).
  llm_call(main_model, TO_ENGLISH_SYSTEM, aisp): Output
```

The main_model is a capable model. It is tasked with rendering AISP back to clean English.

The TO_ENGLISH_SYSTEM branches on tier from ⟦Ε⟧:
- tier ∈ {◊⁺⁺, ◊⁺, ◊, ◊⁻}: Produce PurifiedEnglish.
- tier ≡ ⊘: Produce NeedsClarification from ;; AMBIGUOUS comments.

### Evidence Parsing

```
parse_evidence ≜ λaisp:AISPIntermediate.
  delta_self ≔ match(aisp, /δ[≜=]\s*([\d.]+)/)
  tier_self  ≔ match(aisp, /τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)/)
  EvidenceBlock{delta_self, tier_self}
```

Extract delta_self (ℝ) and tier_self (Tier) from the ⟦Ε⟧ block.

### Delta to Tier

```
tier_from_delta ≜ λδ:ℝ.
  δ ≥ 0.75 → ◊⁺⁺
  δ ≥ 0.60 → ◊⁺
  δ ≥ 0.40 → ◊
  δ ≥ 0.20 → ◊⁻
  δ < 0.20 → ⊘
```

### Input Resolution

purify accepts input from:
1. File argument: if first positional argument is a file path, read that file.
2. Inline argument: if positional arguments are provided, join them.
3. stdin: if stdin is not a TTY, read from stdin.
4. Help: if none of the above, print help and exit with code 0.

### Output Formatting

The result is formatted as:

```
QUALITY: <tier_symbol> <tier_name> (δ=<delta_auth>, self_δ=<delta_self>)
---
<output>
```

If delta_self is not available, omit it from the header.

---

## Errors and Gotchas

### WASM Initialization

**Problem:** Calling AISP.validate() without prior AISP.init() raises TypeError: "Cannot read properties of undefined (reading '_instance')".

**Fix:** Always call await AISP.init() before the first AISP.validate() call.

### ESM-Only Package

**Problem:** Attempting require("aisp-validator") in a CommonJS project raises "Cannot find module aisp-validator/src/index.cjs".

**Fix:** Set package.json type: "module" and use a tsx runner.

### aisp-converter Hardcoded Score

**Problem:** aisp-converter.full_tier always emits δ ≜ 0.82 and τ ≜ ◊⁺⁺, regardless of actual quality.

**Fix:** Do not use aisp-converter for quality assessment. Use aisp-validator instead.

### Score Divergence

**Problem:** |delta_auth - delta_self| > 0.15 indicates the LLM over-reported quality.

**Fix:** Surface both scores in the header. Do not suppress divergence.

### Missing AI_GUIDE.md

**Problem:** AI_GUIDE.md is not found in any candidate location.

**Impact:** Translation fidelity may be lower. This is not a failure.

**Fix (optional):** Download from https://raw.githubusercontent.com/bar181/aisp-open-core/main/AI_GUIDE.md.

---

## Guarantees

- **Purification:** For every prompt *p*, ambiguity(purify(*p*)) < ambiguity(*p*).
- **Round-Trip:** purify ≜ (translate_to_english ∘ validate ∘ translate_to_aisp).
- **Not a Generator:** purify does not write specs from scratch.
- **Validator Authority:** If validation succeeds, validator δ takes precedence.
- **Tier-Driven Behavior:** tier ≡ ⊘ ⇒ agent does not proceed.
- **Model Split:** Step 1 uses purify_model. Step 2 uses main_model.
- **WASM Precondition:** AISP.validate() requires prior AISP.init().
- **Guide Optional:** purify proceeds even if AI_GUIDE.md is absent.
- **Hedge-Free:** No hedge words in output.
- **Divergence Visible:** Score divergence > 0.1 appears in result header.
