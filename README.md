# crucible

**purify** — AISP round-trip spec purification.

A crucible purifies metal under heat by forcing impurities to the surface. This tool does the same for written specs: it routes your input through AISP 5.1 formal grammar and back to English, surfacing hidden ambiguity in the process.

The round-trip invariant: `ambiguity(purify(p)) < ambiguity(p)` for every input `p`.

---

## How it works

1. **English → AISP** (cheap model): your input is translated into AISP 5.1 formal grammar, which forces every constraint into an explicit quantifier, every enumeration to be fully spelled out, and every negation to be explicit. Ambiguities that survive fluent English prose become visible here.
2. **Validate**: an independent WASM validator scores the AISP document (δ ∈ [0, 1]) and assigns a quality tier.
3. **AISP → English** (main model): the formal document is translated back to plain English in your chosen output mode.

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

```bash
purify "inline text or requirement"
purify spec.md
cat spec.md | purify
purify --repl
```

---

## Output modes

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

Output format:

```
QUALITY: ◊⁺⁺ platinum (δ=0.91, self_δ=0.85)
---
<purified English>
```

If the tier is ⊘, output is a `NEEDS_CLARIFICATION` block with specific questions instead.

---

## Options

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
