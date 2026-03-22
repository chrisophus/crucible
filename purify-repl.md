---
# purify REPL — Interactive Mode Specification (v5.1)

---

## Meta Invariants

- The REPL runs a continuous loop: read → process → respond.
- Every turn holds: conversation history, raw input string, purified AISP form, memory cache, and a quality score in \[0, 1\].
- Every message submitted in a turn is purified to AISP before use; raw messages are never stored in history.
- Conversation history is append-only: history at turn *n* is a superset of history at turn *n*−1.
- The system prompt is always cached as ephemeral and remains in cache for the full session.
- Receiving Ctrl-C or `/exit` flushes all buffers and terminates cleanly.
- Purification is deterministic: every input string maps to exactly one AISP output.

---

## Types

| Type | Definition |
|---|---|
| `REPLState` | Tuple of: `turn` (ℕ), `history` (Conv), `pending` (string), `buffer` (list of strings), `cache_size` (ℕ), `last_score` (ℝ\[0,1\], nullable), `last_tier` (◊, nullable) |
| `InputMode` | `multiline` or `singleline` |
| `SubmitSignal` | `empty_line`, `eof`, `ctrl_c`, or `exit_cmd` |
| `CacheBlock` | Tuple of: `type` (string), `id` (hash), `tokens_used` (ℕ), `tokens_created` (ℕ) |
| `QualityReport` | Tuple of: `δ` (ℝ\[0,1\]), `τ` (◊), `reason` (string) |
| `Conv` | List of messages, each with `role` ∈ {`user`, `assistant`, `system`}, `content` (string), `cached` (boolean) |

---

## Rules

### Input Collection

- Each call to `read_line()` that does not return EOF appends the line to the buffer.
- When the current buffer line is an empty string, input is submitted; otherwise the loop continues.

### Submission

When input is submitted:

1. Set `pending` to the raw input string.
2. Purify the input to AISP.
3. Print status `"purified:"` and the purified form to stdout.
4. If validation passes → add to history.
5. If validation fails → print `"validation failed"` and prompt retry.

### History Maintenance

When a validated AISP message is added to history:

1. Create a user message object: `{role: user, content: msg, cached: false}`.
2. Append it to history.
3. Send the updated history to the API; receive a response object.
4. Mark the response object `cached: true`.
5. Append the response to history.
6. Increment `turn` by 1.

### Cache Control

- Every message with `cached = false` receives `cache_control = ephemeral` before being appended to the request.
- When conversation history reaches 5 or more messages, `cache_control = ephemeral` is applied to messages at positions 0–2, yielding approximately 30% cost reduction.

### Quality Scoring

After each API response:

1. Compute `δ = score(response)` ∈ \[0, 1\].
2. Derive `τ = tier(δ)` ∈ {◊⁺⁺, ◊⁺, ◊, ◊⁻, ⊘}.
3. Print `"quality:"` and `"δ=<value> τ=<tier>"` to stdout.
4. Store `δ` as `last_score` and `τ` as `last_tier`.

### Exit Handling

If input is `/exit` or Ctrl-C is received:

1. Print `"flushing history..."` to stderr.
2. Flush all buffers.
3. Terminate the loop.
4. Exit with code 0.

### Multiline Input

- Lines collected in the buffer must be non-empty.
- When all collected lines are non-empty and the next line is empty, the buffer lines are joined with `"\n"` to form the input text.

---

## Functions

### `repl_init()`

1. Initialize history to `[{role: system, content: system_prompt, cached: true}]`.
2. Set `pending = ""`, `buffer = []`, `turn = 0`, `cache_size = 0`.
3. Print to stderr: `"REPL initialized. Type messages (Ctrl-D or /exit to quit, empty line to submit)"`.
4. Start the main loop.

---

### `read_line()`

- Reads from stdin until `"\n"`.
- Returns the line if not EOF.
- Returns `submit_signal(eof)` on EOF.

---

### `append_buffer(line)`

- Appends `line` to `buffer`.

---

### `submit_input(input)`

1. Clear `buffer`.
2. Set `pending = input`.
3. Print `"processing: " + input` to stderr.
4. Call `exec_purify(input)`.

---

### `exec_purify(raw)`

1. Attempt to purify `raw` to AISP.
2. Print `"purified: " + purified` to stderr.
3. Write `purified + "\n"` to stdout.
4. Validate the purified form.
5. If valid → call `add_to_history(purified)`.
6. If not valid → print `"⊘ validation failed"` to stderr and prompt retry.
7. On any exception → print `"error: " + e` to stderr and prompt retry.

---

### `add_to_history(msg)`

1. Create `user_msg = {role: user, content: msg, cached: false}`.
2. Append to history.
3. Build the API request via `build_request(history)`.
4. Call the API; receive `response`.
5. Call `score_and_display(response)`.
6. Create `asst_msg = {role: assistant, content: response, cached: true}`.
7. Append to history.
8. Increment `turn` by 1.

---

### `build_request(hist)`

| Field | Value |
|---|---|
| `system` | Array containing the system prompt text with `cache_control: {type: "ephemeral"}` |
| `messages` | All conversation messages from index 1 onward |
| `max_tokens` | 2048 |
| `model` | `"claude-3-5-sonnet-20241022"` |

---

### `score_and_display(response)`

1. Compute `δ = quality_score(response)`.
2. Compute `τ = tier_from_delta(δ)`.
3. Print `"δ≜<value> τ≜<tier>"` to stderr.
4. Store `δ` as `last_score`, `τ` as `last_tier`.

---

### `quality_score(resp)`

| Condition | Base δ |
|---|---|
| `50 < len(resp) < 5000` | 0.85 |
| `len(resp) ≤ 50` | 0.40 |
| `len(resp) ≥ 5000` | 0.60 |

- If any of the strings `"error"`, `"failed"`, or `"unable"` appear in `resp`, subtract 0.25 from δ.
- Clamp final δ to \[0.0, 1.0\].

---

### `tier_from_delta(δ)`

| Range | Tier |
|---|---|
| δ ≥ 0.75 | ◊⁺⁺ |
| 0.60 ≤ δ < 0.75 | ◊⁺ |
| 0.40 ≤ δ < 0.60 | ◊ |
| 0.20 ≤ δ < 0.40 | ◊⁻ |
| δ < 0.20 | ⊘ |

---

### `handle_exit(sig)`

| Signal | Behavior |
|---|---|
| `'/exit'` or Ctrl-C | Print `"flushing..."` and history size to stderr; exit with code 0 |
| `eof` | Delegate to `handle_exit('/exit')` |
| anything else | Skip |

---

### `loop_step()`

1. Call `read_line()`.
2. If line is non-empty → append to buffer; recurse.
3. If line is empty and buffer is non-empty → join buffer with `"\n"`, call `submit_input`, recurse.
4. If line is empty and buffer is empty → recurse.

---

### `main_repl()`

1. Call `repl_init()`.
2. Call `loop_step()`.

---

## Error Handling

### Validation Error
- Condition: purified form is AISP but fails well-formedness check.
- Action: print `"validation failed: " + parse_error` to stderr; prompt retry.

### API Error
- Condition: `call_api(req)` returns an error.
- Action: print `"API error: " + e` to stderr; remove the last entry from history; prompt retry.

### Input EOF
- Condition: `read_line()` returns EOF.
- Action: call `handle_exit(eof)`.

### Ctrl-C Interrupt
- Condition: Ctrl-C signal received.
- Action: print `"\ninterrupt received"` to stderr; call `handle_exit(Ctrl-C)`.

### Buffer Overflow
- Condition: `len(buffer) > 1000`.
- Action: print `"⊘ buffer overflow"` to stderr; reset `buffer = []` and `pending = ""`.

---

## Cache Strategy

### System Prompt
- Always the first entry in history (`role: system`).
- Always has `cache_control: {type: ephemeral}`.
- Reused across all turns without re-sending.

### Conversation History
- Every new message in `history[1:]` receives `cache_control: {type: ephemeral}`.
- Every 5 messages, the earliest messages are promoted to permanent cache.

### Cache Hit Benefits
- Cost reduction: approximately 25%.
- Latency reduction: approximately 15%.
- Token counts recorded in `CacheBlock.tokens_created`.

---

## CLI Interface

### Invocation

```
purify --repl
```

### Startup Output (stderr)

```
purify REPL v5.1
system prompt cached (ephemeral)
conversation history with prompt caching

```

### Prompts and Output Layout

| Stream | Content |
|---|---|
| stdout | Purified AISP output only |
| stderr | Status messages, quality scores, errors |

- User prompt: `user> ` (stdout)
- Status message format: `[HH:MM:SS] <category>: <message>`
- Quality report format: `δ≜0.XX τ≜◊ᵋ`
