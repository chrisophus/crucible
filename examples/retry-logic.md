# Retry logic

When purify makes an LLM call and something goes wrong, it should try again. Not always — some failures are permanent — but transient stuff like timeouts or rate limits should be retried automatically.

The number of retries should be configurable. Default is probably three attempts total (so two retries). There should be some kind of backoff between attempts, not just immediate retries. Exponential backoff seems right but we don't need anything fancy.

What counts as retryable: network errors, timeouts, HTTP 429 (rate limit), HTTP 5xx from the provider. What doesn't count: bad API keys (401/403), malformed requests (400), or cases where the model just returns something unexpected but technically succeeded.

If all retries are exhausted, purify should fail with a clear error message that says how many attempts were made. The error should include whatever the underlying cause was.

There's also the question of what to do when streaming. If a stream starts and then dies partway through, that's probably not retryable in the same way — or at least the behavior there can be defined later.

The retry configuration should live somewhere sensible. Maybe part of the provider config, maybe a top-level option. Either way it should be possible to set `retries: 0` to disable retries entirely if someone wants that.
