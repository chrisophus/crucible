# MCP Session Flow

## State diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Setup (once per project)                                   │
│                                                             │
│  purify_init({ files: [...] })                              │
│    └─► generates purify.context.md                          │
│         pass contents as `context` on every purify_run      │
└─────────────────────────────────────────────────────────────┘

purify_run({ text, context?, config? })
        │
        ├─► status=has_contradictions
        │     contradictions[]  ──► surface to author
        │                           resolve, then resubmit via purify_run
        │
        ├─► status=needs_clarification
        │     questions[]  ──► collect author answers
        │                  └─► purify_clarify({ session_id, answers })
        │                             │
        │                             ├─► status=has_contradictions  (same as above)
        │                             ├─► status=needs_clarification (repeat, up to max_clarify_rounds)
        │                             └─► status=ready
        │                                       │
        └─► status=ready                         │
                  │◄──────────────────────────────┘
                  ▼
        purify_translate({ session_id, format? })
                  │
                  └─► { purified: "..." }  ◄── deliverable


Updates to an existing session:

purify_update({ session_id, change, context?, config? })
        │
        └─► seeds a NEW session from the previous conversation
            appends the change as a new turn
            re-runs the full pipeline from the top
            follow the same clarify/translate flow to completion
```

## Tool sequence reference

| Step | Tool | When to call |
|------|------|--------------|
| Setup | `purify_init` | Once per project, before first `purify_run` |
| 1 | `purify_run` | Start every new session |
| 2 (conditional) | `purify_clarify` | After `needs_clarification` response |
| 3 | `purify_translate` | After `ready` response |
| Update | `purify_update` | To apply a change to a completed session |

## Config parameters

All parameters are optional. Pass as the `config` object in `purify_run` or `purify_update`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `clarification_mode` | `"always"` \| `"on_low_score"` \| `"never"` | `"never"` | When to generate clarifying questions |
| `score_threshold` | `"◊⁺⁺"` \| `"◊⁺"` \| `"◊"` \| `"◊⁻"` \| `"⊘"` | `"◊"` | Minimum quality tier before proceeding without clarification |
| `ask_on_contradiction` | `boolean` | `true` | Return `has_contradictions` instead of proceeding when contradictions are found |
| `max_clarify_rounds` | `number` | `2` | Maximum clarification rounds before proceeding regardless of score |

## Quality tiers

| Symbol | Name | δ range |
|--------|------|---------|
| ◊⁺⁺ | platinum | ≥ 0.75 |
| ◊⁺ | gold | [0.60, 0.75) |
| ◊ | silver | [0.40, 0.60) |
| ◊⁻ | bronze | [0.20, 0.40) |
| ⊘ | invalid | < 0.20 |

δ is the WASM validator score (authoritative). LLM self-reported scores are recorded but never used for gating decisions.
