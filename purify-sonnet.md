QUALITY: ◊⁺⁺ platinum (δ=1.00, self_δ=0.82)
---
# purify Tool — Specification

## Foundation

purify is a purification tool. It takes English prose and returns cleaner English prose via a round-trip through AISP intermediate form. The round-trip is not cosmetic: AISP grammar forces exhaustive enumeration, explicit negation, and typed relationships that fluent prose does not enforce. Ambiguities hidden by fluent prose become visible after the round-trip.

**What purify is not:**
- purify does not write specs from scratch
- purify is not a linter or format enforcer
- purify does not execute AISP
- purify does not block work based on quality scores

**The core invariant:** For every prompt `p`, the ambiguity of `purify(p)` is less than the ambiguity of `p`.

**The round-trip:** `purify(p)` = translate\_to\_english ∘ validate ∘ translate\_to\_aisp

**Why AISP constraints are stronger than English rules:** An English rule such as "NEVER update event tables" can be rationalized past by an agent. The AISP form `∀t∈EventTables:¬∃update(t)` has no grammatically valid interpretation that permits an update.

---

## Types

### Quality Tiers

| Symbol | Name | δ Range |
|--------|------|---------|
| `⊘` | invalid | δ < 0.20 — input too thin or contradictory to translate |
| `◊⁻` | bronze | δ ∈ [0.20, 0.40) |
| `◊` | silver | δ ∈ [0.40, 0.60) |
| `◊⁺` | gold | δ ∈ [0.60, 0.75) |
| `◊⁺⁺` | platinum | δ ≥ 0.75 |

### Model Roles

| Role | Purpose | Anthropic Default | OpenAI Default |
|------|---------|-------------------|----------------|
| `purify_model` | Cheap model. English → AISP. Constrained grammar task. | `claude-haiku-4-5-20251001` | `gpt-4o-mini` |
| `main_model` | Capable model. AISP → English. Requires nuance judgment. | `claude-sonnet-4-6` | `gpt-4o` |

### Input Sources

`inline` | `file` | `stdin`

### Prompt

Raw English: a task description, spec fragment, constraint list, or requirement set. May be vague, hedged, or incomplete. purify treats all of these identically.

### AISP Intermediate (`AISPIntermediate`)

The AISP translation produced by `purify_model`. Not shown to the user unless `--verbose`.

**Required blocks:** `𝔸header`, `⟦Ω⟧`, `⟦Σ⟧`, `⟦Γ⟧`, `⟦Λ⟧`, `⟦Ε⟧`
**Optional block:** `⟦Χ⟧`

### Validation Result

| Field | Type | Notes |
|-------|------|-------|
| `valid` | boolean | |
| `delta` | real | Semantic density δ = (blockScore × 0.4) + (bindingScore × 0.6) |
| `tier` | Tier | |
| `ambiguity` | real | From aisp-validator WASM kernel |
| `pure_density` | real | \|AISP symbols\| ÷ \|non-whitespace tokens\| |

### Evidence Block

| Field | Type | Notes |
|-------|------|-------|
| `delta_self` | real | LLM self-reported δ from `⟦Ε⟧` |
| `tier_self` | Tier | LLM self-reported τ |

### Result

| Field | Type | Notes |
|-------|------|-------|
| `tier` | Tier | |
| `delta_auth` | real | Authoritative δ — validator score preferred, self-reported score as fallback |
| `delta_self` | real | nullable — included for divergence detection |
| `output` | Output | |

### Output

Either `PurifiedEnglish` or `NeedsClarification`.

**PurifiedEnglish:** Clean markdown. No hedge words. No preamble. Invariants expressed as declarative statements. Negations expressed as "must not" or "never". Enumerations fully listed — no "etc.", no implied values. Code blocks preserved verbatim. No rationale added beyond the AISP source.

**NeedsClarification:** 1–7 specific, answerable questions derived from `AMBIGUOUS` comments in the AISP. Binary or multiple-choice preferred. No open-ended questions.

---

## Rules

### Translation Rules — English → AISP (purify\_model)

- Every constraint becomes a universal quantifier (`∀`), existential (`∃`), negation (`¬`), or implication (`⇒`) expression.
- Every enumeration is fully spelled out. Every value is listed explicitly. No implied values.
- Every relationship has typed source and typed target.
- Conditionals use implication (`X ⇒ Y`), not prose.
- Negations use `¬`, `≠`, or `∉` explicitly — not implied by omission.
- Nullable fields carry a `?` suffix.
- Unresolvable ambiguities are marked with `AMBIGUOUS:` comments. They are never silently resolved.

### Scoring Rules

- When validation succeeds, `delta_auth` = the validator's δ.
- When validation fails, `delta_auth` = the self-reported δ from `⟦Ε⟧`.
- When `|delta_auth − delta_self| > 0.1`, both scores are surfaced. Neither is suppressed.

### Tier-to-Behavior Rules

| Tier | Output | Agent behavior |
|------|--------|----------------|
| `◊⁺⁺` or `◊⁺` | Purified English | Proceeds without confirming assumptions |
| `◊` or `◊⁻` | Purified English | Proceeds, but must confirm assumptions before making file changes |
| `⊘` | NeedsClarification | Must not proceed |

### Translation Rules — AISP → English (main\_model)

- Translation is lossless. No rationale is added. No content is dropped.
- The following words must not appear in output: `typically`, `usually`, `often`, `generally`, `might`, `may`, `could`, `probably`
- Code blocks are preserved verbatim.

### Pipeline Rules

- Step 1 uses `purify_model`. Direction: English → AISP.
- Step 2 uses `main_model`. Direction: AISP → English.
- Without `--verbose`, the AISP intermediate is never shown to the user.
- With `--verbose`, the AISP intermediate is written to stderr.

---

## Pipeline

```
purify(p):
  aisp     = step1_to_aisp(p)
  vr       = try(validate(aisp))        // aisp-validator WASM; may fail
  ev       = parse_evidence(aisp)       // parse ⟦Ε⟧ block
  δ_auth   = vr?.delta ∨ ev.delta_self
  tier     = tier_from_delta(δ_auth)
  output   = step2_to_english(aisp, tier)
  → Result{ tier, delta_auth: δ_auth, delta_self: ev.delta_self, output }
```

### Step 1 — English → AISP

```
step1_to_aisp(p):
  guide  = load_guide(script_dir)       // optional — prepended if found
  system = guide? ∘ TO_AISP_SYSTEM : TO_AISP_SYSTEM
  → llm_call(purify_model, system, p)
```

### Validation

```
validate(aisp):
  await AISP.init()                     // loads WASM kernel — required before validate()
  → AISP.validate(aisp)
```

`calculateSemanticDensity()` is available standalone without calling `init()`.

### Step 2 — AISP → English or Clarification

```
step2_to_english(aisp, tier):
  → llm_call(main_model, TO_ENGLISH_SYSTEM, aisp)
```

`TO_ENGLISH_SYSTEM` branches on the tier from `⟦Ε⟧`:
- Tier is `◊⁺⁺`, `◊⁺`, `◊`, or `◊⁻` → produce PurifiedEnglish
- Tier is `⊘` → produce NeedsClarification from `AMBIGUOUS` comments

### Evidence Parsing

```
parse_evidence(aisp):
  delta_self ← match(aisp, /δ[≜=]\s*([\d.]+)/)
  tier_self  ← match(aisp, /τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)/)
  → EvidenceBlock{ delta_self, tier_self }
```

### Delta to Tier

| Condition | Tier |
|-----------|------|
| δ ≥ 0.75 | `◊⁺⁺` |
| δ ≥ 0.60 | `◊⁺` |
| δ ≥ 0.40 | `◊` |
| δ ≥ 0.20 | `◊⁻` |
| δ < 0.20 | `⊘` |

### Output Formatting

```
format_result(r):
  "QUALITY: " + tier_symbol(r.tier) + " " + tier_name(r.tier) +
  " (δ=" + r.delta_auth + ", self_δ=" + r.delta_self + ")" +
  "\n---\n" + r.output
```

### Input Resolution

```
resolve_input(args):
  args.positional ∧ is_file(args.positional[0]) → read_file(args.positional[0])
  args.positional                               → join(args.positional)
  ¬stdin.isTTY                                  → read_stdin()
  ∅                                             → print_help() ∧ exit(0)
```

### AI\_GUIDE.md Resolution

```
load_guide(script_dir):
  candidates = [
    env("AISP_GUIDE"),
    script_dir + "/AI_GUIDE.md",
    home() + "/.config/aisp/AI_GUIDE.md"
  ]
  → first(candidates, file_exists)   // nullable
```

- If found: prepended to `TO_AISP_SYSTEM` for Step 1.
- If absent: purify proceeds with the built-in symbol reference. This is not a failure.

---

## Errors and Known Issues

### `ε_wasm` — Validator called before initialization

- **Trigger:** `AISP.validate()` called without a prior `AISP.init()`
- **Symptom:** `TypeError: Cannot read properties of undefined (reading '_instance')`
- **Fix:** Call `await AISP.init()` before the first `AISP.validate()` call

### `ε_cjs` — ESM-only package used in CommonJS context

- **Trigger:** `require("aisp-validator")` with `package.type` not set to `"module"`
- **Symptom:** `Cannot find module aisp-validator/src/index.cjs`
- **Fix:** Set `"type": "module"` in `package.json`; use the `tsx` runner

### `ε_converter` — aisp-converter quality score is hardcoded

- **Trigger:** Using `aisp-converter` for quality assessment
- **Meaning:** `aisp-converter` always emits δ = 0.82 and τ = `◊⁺⁺`. This is not a real quality measurement.
- **Fix:** Use `aisp-validator` for quality assessment. Never use `aisp-converter` for this purpose.

### `ε_diverge` — Validator δ and self-reported δ diverge significantly

- **Trigger:** `|delta_auth − delta_self| > 0.15`
- **Meaning:** The LLM over-reported quality. The validator score is authoritative.
- **Action:** Surface both scores. Never suppress either.

### `ε_no_guide` — AI\_GUIDE.md not found

- **Trigger:** `AI_GUIDE.md` absent from all candidate paths
- **Impact:** Lower translation fidelity is possible. This is not a failure.
- **Fix:**
  ```
  curl -sL https://raw.githubusercontent.com/bar181/aisp-open-core/main/AI_GUIDE.md
  ```
