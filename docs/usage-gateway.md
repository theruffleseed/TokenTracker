# Usage gateway

TokenTracker can act as an OpenAI- and Anthropic-compatible proxy for
**TokenHarbor** and **River** connections. Requests sent through it are recorded
as token usage and converted to an estimated USD cost using the vendor's public
list prices.

This is the zero-touch path for providers that expose no balance or usage API.
It has one unavoidable limitation: **requests that bypass the gateway are not
counted.** The vendor key still works directly; only traffic whose base URL
points at TokenTracker is observed.

## Setup

1. Open **Settings → Usage gateway** and create a token. It starts with `ttg_`
   and is shown once; only a SHA-256 digest is stored.
2. Open the TokenHarbor or River connection. Its **Usage gateway** panel shows
   two base URLs.
3. Point the client at the account's URL and use the gateway token as the API
   key.

OpenAI-compatible example:

```bash
export OPENAI_BASE_URL="https://your-host/api/gateway/<accountId>/v1"
export OPENAI_API_KEY="ttg_…"
```

Anthropic-compatible example (the SDK appends `/v1/messages`):

```bash
export ANTHROPIC_BASE_URL="https://your-host/api/gateway/<accountId>"
export ANTHROPIC_API_KEY="ttg_…"
# or ANTHROPIC_AUTH_TOKEN, which some clients send as Authorization: Bearer
```

The gateway also accepts `x-api-key: ttg_…`. The provider key is decrypted on
the server, sent upstream, and never returned to the browser.

## Supported paths

| Path | Method | Metered |
| --- | --- | --- |
| `/v1/chat/completions` | POST | yes, including SSE |
| `/v1/messages` | POST | yes, including SSE |
| `/v1/responses` | POST | yes, including SSE |
| `/v1/messages/count_tokens` | POST | no |
| `/v1/models` | GET | no |

All other paths return `404`; other methods return `405`. Request bodies are
limited to 10 MB, and inference is never retried (a retry would double-bill).

For streamed OpenAI chat requests the gateway adds
`stream_options.include_usage = true` so the final chunk carries usage. If a
compatible server ignores that option, no usage is recorded for that stream —
nothing is guessed.

## What is recorded

For each completed request the gateway stores a `UsageRecord` with
`source = ESTIMATED`:

- model ID
- uncached input tokens, cached input tokens, cache-write tokens
- output tokens and reasoning tokens where reported
- USD cost from public list prices
- cache reads and writes priced separately when the vendor publishes rates

Balances are re-derived from the newest **Live** or **Manual** anchor, minus
estimated spend since that anchor:

- **River**: the highest-priority USD balance is reduced (wallet, then
  promotional, then reward).
- **TokenHarbor with a Pass value anchor**: included allowance is reduced;
  the wallet is left alone.
- **TokenHarbor with a tracked Pass window but no value anchor**: the wallet is
  left alone, because the Pass — not the wallet — funds that usage.
- **TokenHarbor weekly paid-model window**: when a Pass tier is set (Agent,
  Office, or Frontier), public list spend is converted into the published
  weekly allowance ($2.50, $8.75, or $45.00). A prior manual weekly limit or
  reset time is used as the anchor when present.
- Without a Pass tier or a prior weekly anchor, no weekly percentage is
  invented. The balance and gateway activity are still tracked.

Re-deriving from the anchor makes the result idempotent: adding a fresh manual
snapshot resets the baseline, and only spend after that snapshot is subtracted
again. Estimated snapshots update in place rather than accumulating per request.

## Accuracy limits

- List prices can differ from negotiated, promotional, off-peak, or
  long-context rates.
- TokenHarbor's free-model allowance is not cost-based and is not estimated.
- Requests that fail after partial generation, or disconnect before the final
  usage event, may not produce a usage record.
- Only the gateway sees the request. Console usage, other devices, and direct
  API calls are invisible.
- Costs are estimates, not invoices. The vendor console remains authoritative.

## Failure behavior

Gateway errors use the OpenAI error shape and never include provider keys.

| Status | Meaning |
| --- | --- |
| `401` | Missing or invalid gateway token |
| `403` | Connection paused |
| `404` | Unknown connection or unsupported path |
| `409` | No provider key stored |
| `413` | Body over 10 MB |
| `502` | Upstream unreachable |

Upstream `4xx`/`5xx` responses are passed through unchanged. Usage persistence
runs in a serialized background queue, so a database or pricing failure cannot
interrupt the provider response.
