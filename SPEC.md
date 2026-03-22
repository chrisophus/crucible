QUALITY: ◊⁺⁺ platinum (δ=1.00, self_δ=0.82)
---
# Purify — Specification

## Invariants

- Every input — whether a file, inline text, or stdin — maps to exactly one pipeline execution producing one output.
- Step 1 (English → AISP) always completes before Step 2 (AISP → English) begins.
- Every run validates and parses the AISP intermediate to determine the authoritative delta.
- The authoritative delta is the validator's delta if the validator succeeds; otherwise it is the self-reported delta from the AISP evidence block.
- The tier is derived from the authoritative delta and must be one of: ◊⁺⁺, ◊⁺, ◊, ◊⁻, ⊘.
- If the tier is ⊘, the output is a `NEEDS_CLARIFICATION` block with numbered questions.
- If the tier is not ⊘, the output is purified English.
- A valid API key must exist for the selected provider; if none exists, the process exits with code 1.
- Step 1 uses the cheap model; Step 2 uses the main model.

---

## Types

| Type | Values |
|---|---|
| `Provider` | `anthropic`, `openai` |
| `Tier` | ◊⁺⁺, ◊⁺, ◊, ◊⁻, ⊘ |
| `TierName` | ◊⁺⁺ → platinum, ◊⁺ → gold, ◊ → silver, ◊⁻ → bronze, ⊘ → invalid |
| `InputMode` | `File`, `InlineText`, `Stdin` |
| `OutputMode` | `PurifiedEnglish`, `NeedsClarification` |
| `Delta` | Real number in `[0.00, 1.00]` |
| `Evidence` | `{ delta: Delta (nullable), tierSymbol: Tier, tierName: TierName }` |
| `ValidatorResult` | `{ valid: boolean, delta: Delta, tier: string, ambiguity: real, pureDensity: real }` |
| `Config` | `{ provider: Provider, mainModel: string, purifyModel: string, apiKey: string, verbose: boolean }` |

---

## Entities

### InputResolver

| Field | Type | Notes |
|---|---|---|
| `positional` | `List<string>` | Arguments passed on the command line |
| `isFile` | boolean | True if and only if exactly one positional argument is given and that path exists on disk |
| `isTTY` | boolean | True if and only if `process.stdin.isTTY` is set |
| `resolved` | string (nullable) | Null means no input was resolved; print help and exit |

### ModelDefaults

| Provider | Main model | Cheap model |
|---|---|---|
| `anthropic` | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` |
| `openai` | `gpt-4o` | `gpt-4o-mini` |

**Override precedence — main model:** CLI flag > `PURIFY_MODEL` env var > `ModelDefaults.main`

**Override precedence — cheap model:** CLI flag > `PURIFY_MODEL_CHEAP` env var > `ModelDefaults.cheap`

**Override precedence — provider:** `--provider` CLI flag > `PURIFY_PROVIDER` env var > `anthropic`

### AISPIntermediate

| Field | Type | Notes |
|---|---|---|
| `body` | string | Raw AISP 5.1 document text |
| `selfEvidence` | `Evidence` | Parsed from the AISP evidence block |
| `validatorResult` | `ValidatorResult` (nullable) | Null if the validator fails |

### PurifyOutput

| Field | Type | Notes |
|---|---|---|
| `qualityLine` | string | `QUALITY: <tier> <name> (δ=X, self_δ=Y)` |
| `separator` | string | `---` |
| `body` | string | Purified English or `NEEDS_CLARIFICATION` block |

---

## Functions

### `purify(cfg, text) → PurifyOutput`

1. Call the LLM using `cfg.provider`, `cfg.purifyModel`, the Step 1 system prompt, and `text` → `aisp`
2. Parse the evidence block from `aisp` → `self`
3. Run the independent validator on `aisp` → `vResult` (nullable)
4. Set `δ_auth` = `vResult.delta` if `vResult` is not null; otherwise `self.delta`
5. Compute `tier = calcTier(δ_auth)`
6. Call the LLM using `cfg.provider`, `cfg.mainModel`, the Step 2 system prompt, and `aisp` → `english`
7. Return `PurifyOutput(qualityLine(tier, δ_auth, self.delta), "---", english)`

---

### `callLLM(provider, model, system, user) → string`

| Provider | Call |
|---|---|
| `anthropic` | `Anthropic.messages.create(model, system, user)` → `.text` |
| `openai` | `OpenAI.chat.completions.create(model, system, user)` → `.content` |

---

### `calcTier(δ) → Tier`

| Condition | Tier |
|---|---|
| `δ` is null | ⊘ |
| `δ ≥ 0.75` | ◊⁺⁺ |
| `δ ≥ 0.60` | ◊⁺ |
| `δ ≥ 0.40` | ◊ |
| `δ ≥ 0.20` | ◊⁻ |
| otherwise | ⊘ |

---

### `parseEvidence(aisp) → Evidence`

1. Extract `δ` by matching `/δ[≜=]\s*([\d.]+)/` and parsing as float (nullable if no match).
2. Extract `τ` by matching `/τ[≜=]\s*(◊⁺⁺|◊⁺|◊⁻|◊|⊘)/`; if no match, compute `τ = calcTier(δ)`.
3. Return `Evidence(δ, τ, TierName[τ])`.

---

### `runValidator(aisp) → ValidatorResult?`

1. Call `AISP.init()` then `AISP.validate(aisp)` → `{ valid, tier, ambiguity }`.
2. Call `calculateSemanticDensity(aisp)` → `{ delta, pureDensity }`.
3. Return `ValidatorResult(valid, delta, tier, ambiguity, pureDensity)`.
4. If any step throws, return null. Validator failure is non-fatal.

---

### `resolveInput(args) → string?`

| Condition | Result |
|---|---|
| Exactly one argument and the path exists on disk | Read and return file contents |
| One or more arguments (and path does not exist) | Join arguments with spaces and return |
| No arguments and stdin is not a TTY | Read and return `/dev/stdin` |
| Otherwise | Return null |

---

## Constraints

### Input

- If the trimmed input is empty, print help and exit with code 0.
- If a positional argument does not resolve to an existing file, it is treated as inline text — not an error.

### API Keys

- If `ANTHROPIC_API_KEY` is absent and no explicit key is provided and the provider is `anthropic`, write to stderr and exit with code 1.
- If `OPENAI_API_KEY` is absent and no explicit key is provided and the provider is `openai`, write to stderr and exit with code 1.

### LLM Calls

- Every LLM call uses `max_tokens = 8096`.
- Step 1 and Step 2 are sequential. Step 2 must never start before Step 1 completes.

### Scoring Authority

- If `validatorResult` is not null, `δ_auth` is `validatorResult.delta`.
- If `validatorResult` is null, `δ_auth` is `selfEvidence.delta`.
- If `selfEvidence.delta` is null, the tier is ⊘.

### Output Format

- Line 1 of every output: `QUALITY: <tier> <name> (δ=X, self_δ=Y)`
- Line 2 of every output: `---`
- If the tier is not ⊘, the body is purified English markdown. Hedge words must not appear.
- If the tier is ⊘, the body starts with `NEEDS_CLARIFICATION`, followed by at most 7 numbered questions.

### Verbose Mode

- If verbose is enabled, write the AISP intermediate and validator scores to stderr only.
- If verbose is not enabled, stderr must be silent.
