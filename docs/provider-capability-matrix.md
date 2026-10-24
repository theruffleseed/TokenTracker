# Provider capability matrix

**Research date:** 2026-10-24
**Scope:** read-only quota, credit, reset, and usage capabilities for the four
providers TokenTracker supports.

This document is deliberately conservative. A provider is marked **verified
live** only when an official, documented API is used. Routes that are only known
from the vendor CLI or community tooling are marked **experimental**, are gated
behind `ENABLE_EXPERIMENTAL_ADAPTERS`, and are never required for the app to
work. No adapter scrapes the browser DOM, imports session cookies, or makes paid
inference requests to measure quota.

## Summary

| Provider | Credential | 5-hour quota | Weekly quota | Monthly quota | Credit/balance | Usage history | Per-model limits | Integration status |
|---|---|---|---|---|---|---|---|---|
| **OpenCode Go** | Go API key (`oc_sk_…`) | Yes | Yes | Optional (plan-dependent) | **No** (Zen balance has no API-key endpoint) | No | No | Experimental live meters |
| **TokenHarbor** | Universal Key (`thk_live_…`) | No | Free 7-day allowance only (no API) | Pass allowance (no API) | Wallet balance (no API) | No | No | Key probe + manual |
| **River AI** | API key (`rv_…`) | No | No | No | Console only (no API) | No | No | Key probe + manual |
| **Command Code** | API key | Yes | Yes | Yes | Extra/purchased credits | No (aggregate only) | No | Experimental live meters |

### Verification legend

- **Documented** — described in the vendor's public documentation.
- **Community-observed** — used by the vendor CLI and/or community tools, but
  absent from the public API contract. May change without notice.
- **Manual** — the console shows the value but no supported machine interface
  exists. The user records a snapshot and it is stored with `source = MANUAL`.
- **Not supported** — no documented interface and no reliable observation. The
  app shows an explicit unsupported state, never zero.

### What was actually tested

- Every adapter has unit tests for parsing, normalization, authentication
  errors, malformed payloads, rate limits, timeouts, and bounded retries.
- HTTP behavior is contract-tested against mocked responses and synthetic
  fixtures. Fixtures contain no customer data.
- **No real vendor account credentials were available during this build.** The
  OpenCode Go and Command Code routes are therefore *contract-tested, not
  account-tested*. This is the main remaining verification gap. If a live
  response differs, the adapter must fail with a `MALFORMED_RESPONSE`
  diagnostic rather than display guessed numbers.
- TokenHarbor and River adapters were validated only against their documented
  models endpoints' semantics; no live key was available either.

---

## OpenCode Go

**Official docs:** <https://opencode.ai/docs/go/> and
<https://opencode.ai/v2/docs/console/go/>

### Verified product facts (documented)

- Go is a $10/month subscription; Go Plus is $40/month.
- Allowances are enforced across three windows: a rolling 5-hour window, a
  weekly window, and a monthly period. The console shows usage per model.
- A Go API key is created in OpenCode Console and used with the
  Anthropic/OpenAI-compatible endpoints under `https://opencode.ai/zen/go/v1/`.
- OpenCode Zen is a separate pay-as-you-go balance. The official feature request
  for a Zen balance API remains open; there is **no API-key-authenticated Zen
  balance endpoint** documented.

### Quota interface (community-observed, experimental)

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OPENCODE_GO_API_KEY>
```

Observed response shape (not guaranteed by OpenCode):

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 17, "resetsAt": "2026-10-24T15:30:00Z" },
    "weekly":  { "status": "ok", "percent": 7,  "resetsAt": "2026-10-27T00:00:00Z" },
    "monthly": { "status": "ok", "percent": 3,  "resetsAt": "2026-11-13T14:00:00Z" }
  }
}
```

- `percent` is **used** percentage. The adapter converts it to a 0–100
  remaining percentage and stores both `limit = 100` and the used/remaining
  values in the `PERCENT` unit.
- Missing windows are omitted. They are never synthesized as 0%.
- The adapter defensively accepts bare window objects, `limit`/`used` pairs,
  and `resetsInSeconds` instead of `resetsAt`.
- Model names are not meters here: the published per-model request counts are
  estimates, not account usage. No `modelScope` values are fabricated.

### Authentication and limits

- Auth: `Authorization: Bearer <key>`.
- 401 → `INVALID_CREDENTIALS`; 403 → `FORBIDDEN`.
- 429 → `RATE_LIMITED`, honoring `Retry-After` when present, with a maximum of
  one retry.
- Timeout: 10 seconds by default (`PROVIDER_HTTP_TIMEOUT_MS`).
- Unknown upstream rate limits. The default refresh cadence is 30 minutes; the
  console itself is the source of truth.
- The adapter is read-only and performs exactly one GET per refresh.

### Enablement

Requires `ENABLE_EXPERIMENTAL_ADAPTERS=true` and an explicit live connection.
When disabled, OpenCode Go can still be tracked entirely with manual snapshots.

---

## TokenHarbor

**Official docs:** <https://tokenharbor.ai/docs> (credits, Passes, API, rate
limits, Universal Key)

### Verified product facts (documented)

- One Universal Key (`thk_live_…`) authenticates OpenAI-compatible and
  Anthropic-compatible inference.
- Wallet is a prepaid USD balance. New accounts start at $0. Top-ups are
  withdrawable; promotional/reward credits are not.
- Passes (Agent $10, Office $35, Frontier $180 of included usage value) refresh
  every four weeks and are divided into four 7-day windows. Each window gets a
  quarter of the allowance; unused allowance does not carry forward.
- The free allowance is value-based over a rolling 7-day period and is tracked
  as a percentage in the dashboard.
- `GET https://tokenharbor.ai/v1/models` is documented and requires an
  API key. It lists model IDs.
- **No documented endpoint exposes wallet balance, Pass usage, or the free
  allowance.** The docs describe the dashboard and a CSV export, not an API.
  There is no key-management API either.

### Integration

- Live: a single `GET /v1/models` request validates the key and confirms the
  connection. It does not meter inference and has no known billable cost.
- Quota and balance: **manual only**. The UI labels entries `Manual`.
- Expected manual metrics:
  - Wallet balance (`WALLET`, USD)
  - Promotional/reward balance (`PROMOTIONAL` / `REWARD`, USD)
  - Pass window remaining (`INCLUDED_ALLOWANCE`, USD, weekly or monthly)
  - Free allowance remaining (percent, rolling 7-day window, `OTHER`/`WEEKLY`)
- Do not combine the Pass allowance (usage value) with wallet balance. They are
  separate credit types and are rendered separately.

### Limits and failure modes

- 401 → invalid key. 429 is retryable; `Retry-After` is honored.
- The adapter has no quota call to fail, so a manual connection never shows a
  fake live value.

---

## River AI

**Official docs:** <https://docs.river.ai/> and
<https://console.river.ai/api/public/pricing>

### Naming ambiguity (recorded, not resolved)

There are two similarly named products:

1. **River** (`river.ai`, documented inference API at `api.river.ai`): prepaid
   pay-as-you-go, per-token pricing, errors include `402` for insufficient
   balance, no published account-balance API.
2. **River AI** (`riverai.tech`): a separate $50/month subscription product with
   $10 included usage and overage billing, according to its public terms.

TokenTracker implements the **documented inference platform** (`api.river.ai`)
because it has a public API contract. If the user's "River AI" account is the
`riverai.tech` subscription, the live key probe will not apply; use manual
tracking. This ambiguity is surfaced in the connection UI as a manual-first
provider.

### Verified facts

- API base: `https://api.river.ai/v1`; `GET /v1/models` is documented.
- Pricing is public at `https://console.river.ai/api/public/pricing`; it is
  pricing, not account balance, and is not used for quota.
- `402` means insufficient balance. It is a signal, not a balance value.
- No documented endpoint returns current account balance, plan allowance, or
  reset times.

### Integration

- Live: `GET /v1/models` validates the key (read-only, no inference).
- Quota/credit: **manual only**. Entries are labeled `Manual`.
- Expected manual metrics: USD balance (`WALLET`) and any monthly included
  usage (`INCLUDED_ALLOWANCE`).

---

## Command Code

**Official docs:** <https://commandcode.ai/docs/resources/pricing-limits>,
<https://commandcode.ai/docs/provider>

### Verified product facts (documented)

- Plans include monthly credit values and two rolling caps measured in credit
  value (USD): a 5-hour window and a weekly window.
- The CLI exposes live meters through `/usage`:
  `5-hour 32% · resets in 3h 12m`, `Weekly 41% · resets in 2d 4h`.
- Monthly credits reset with the billing cycle. Top-up/on-demand credits are
  exempt from the rolling windows and roll over.
- The documented Provider API (`/provider/v1/...`) is for inference and does not
  expose billing/usage. It must not be called to measure quota.
- Per-model request tables are estimates, not account usage; there is no
  per-model usage breakdown in the billing payload.

### Quota interface (alpha CLI contract, experimental)

Used by the `cmd` CLI and documented by community tools such as CodexBar and
OpenUsage:

```
GET https://api.commandcode.ai/alpha/billing/credits
GET https://api.commandcode.ai/alpha/billing/subscriptions
GET https://api.commandcode.ai/alpha/whoami?limits=1
Authorization: Bearer <COMMAND_CODE_API_KEY>
```

Normalization:

| Upstream field | Stored metric |
|---|---|
| `monthlyCreditsGranted` (or `monthlyGrant`, `monthlyCreditsLimit`) | Monthly quota limit |
| `monthlyCredits` | Monthly quota remaining; used is derived |
| `windowLimits.fiveHour.{used,cap,resetAt}` | Rolling 5-hour window, USD |
| `windowLimits.weekly.{used,cap,resetAt}` | Weekly window, USD |
| `purchasedCredits` | Credit snapshot, type `WALLET`, USD |
| `freeCredits` | Credit snapshot, type `REWARD`, USD |
| `subscriptions.planId` / `planName` | Display plan name |
| `subscriptions.currentPeriodEnd` | Monthly reset timestamp |
| `whoami.email` / `username` | Account label |

- If a value is absent, it stays `null`. The adapter does **not** infer a
  monthly grant from a plan ID.
- `resetAt` is accepted as epoch milliseconds and converted to UTC ISO.
- Optional subscription/whoami failures are recorded as diagnostics and do not
  fail the quota refresh.
- Monthly allowance, rolling caps, and extra credits are kept distinct.
- The alpha routes may change. A parse failure surfaces as
  `MALFORMED_RESPONSE` with diagnostics; no fallback numbers are shown.

### Authentication and limits

- Bearer API key, same key as the CLI and Provider API.
- 401/403 fail immediately; 429 and 5xx use one bounded retry.
- Timeout: 10 seconds by default.
- Requires `ENABLE_EXPERIMENTAL_ADAPTERS=true`.
- A manual connection needs no key and remains fully usable if the alpha
  endpoints are unavailable.

---

## Unsupported and deliberately excluded metrics

| Metric | Reason |
|---|---|
| OpenCode Zen wallet balance | No documented API-key endpoint; session scraping excluded. |
| TokenHarbor wallet / Pass usage | Not exposed by API; dashboard-only. Manual entry. |
| River current balance | Not exposed by API; `402` is only a failure signal. Manual entry. |
| Command Code per-model usage | Billing summary is account-aggregate only. |
| Any provider's session cookies | Explicitly out of scope; never collected or stored. |
| Live token analytics | Not needed for quota tracking and not available from the meter routes. |

## Data source semantics

| Label | Meaning |
|---|---|
| **Live** | Retrieved from a provider endpoint during this refresh. |
| **Manual** | Entered by the user from the provider console. |
| **Cached** | Reserved for a previously fetched live value served without a refresh. Current adapters do not cache. |
| **Estimated** | Reserved. Adapters do not generate estimates; published request-count tables are not imported. |

## Enabling experimental adapters

```bash
ENABLE_EXPERIMENTAL_ADAPTERS=true
```

Keep this `false` unless you accept that the two quota routes are outside the
vendors' documented API contracts. Existing manual snapshots are unaffected by
this flag. Security boundaries and threat model: `docs/security.md`.
