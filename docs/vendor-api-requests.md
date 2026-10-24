# Vendor API requests (draft — not sent)

Status: **drafts only.** Do not send these messages or post them publicly without
the account owner's explicit approval.

Goal: replace recurring manual entry with a **read-only, documented** source for
wallet balance and usage. TokenTracker does not scrape consoles, replay session
cookies, or call inference endpoints to meter usage. Both vendors' published
terms prohibit systematic extraction, so an official endpoint is the compliant
path.

As of 2026-10-24:

- TokenHarbor documents a Universal Key, `/v1/models`, inference routes, a
  dashboard, and a billing CSV. It does **not** document a balance or usage API.
  The CSV has wallet transactions only; Office Pass weekly usage is absent.
- River documents inference and model routes. It does **not** document a
  balance, credit, or allowance endpoint. `402` is only an insufficient-balance
  signal.

Fill in the bracketed details before sending.

---

## TokenHarbor

**Send to:** `hello@tokenharbor.ai` (cc `billing@tokenharbor.ai` if the question
is billing-related)
**Subject:** Read-only API for wallet balance and Office Pass usage?

Hi TokenHarbor team,

I maintain a personal quota dashboard and use a Universal Key with an Office
Pass. I'd like to show current balance and Office Pass usage without repeatedly
copying values from the dashboard or importing the billing CSV.

Could you confirm whether there is a documented, read-only endpoint for:

1. current wallet / promotional / reward balances, and
2. the current Office Pass windows for paid models and free models (used,
   limit, remaining, and reset time).

If none exists, would you consider adding something like:

```http
GET /v1/account/balance
Authorization: Bearer thk_live_…
```

```json
{
  "currency": "USD",
  "wallet": "1037.50",
  "promotional": "0.00",
  "as_of": "2026-10-24T09:00:00Z"
}
```

```http
GET /v1/account/usage?window=current
Authorization: Bearer thk_live_…
```

```json
{
  "plan": "Office Pass",
  "windows": [
    {
      "scope": "paid_models",
      "window": "weekly",
      "window_start": "2026-10-21T00:00:00Z",
      "window_end": "2026-10-28T00:00:00Z",
      "limit_usd": "8.75",
      "used_usd": "4.20",
      "remaining_percent": "52.0"
    },
    {
      "scope": "free_models",
      "window": "weekly",
      "limit_usd": "2.00",
      "used_usd": "0.40",
      "remaining_percent": "80.0"
    }
  ]
}
```

A single `GET /v1/account` returning both objects would also work.

Requirements from my side:

- Read-only; no inference calls and no billable usage.
- Bearer authentication with the existing Universal Key, or a separate
  read-only key scope.
- Polling no more often than every 5–15 minutes.
- Documented response schema and rate limits so failures can be handled
  explicitly.

If this already exists, a documentation link and one example response would be
enough for me to implement it. If it is not planned, I'll keep the manual
workflow and CSV import in the meantime.

Thanks,
[Name]
[Account email]

---

## River AI

**Send via:** <https://river.ai/#contact> (no support email is published in the
public docs)
**Subject:** Read-only account balance / included-usage endpoint?

Hi River team,

I maintain a personal quota dashboard for my own River account. I'd like to
display the current prepaid balance (and, if applicable, included monthly usage)
without copying it from the console.

Is there a documented, read-only endpoint for either value? For example:

```http
GET /v1/account/balance
Authorization: Bearer rv_…
```

```json
{
  "currency": "USD",
  "balance": "42.50",
  "as_of": "2026-10-24T09:00:00Z"
}
```

```http
GET /v1/account/usage
Authorization: Bearer rv_…
```

```json
{
  "plan": "…",
  "period_start": "2026-10-01T00:00:00Z",
  "period_end": "2026-11-01T00:00:00Z",
  "included_used_usd": "12.34",
  "included_limit_usd": "50.00",
  "overage_usd": "0.00"
}
```

I only need a read-only call. I will not poll more often than every 5–15
minutes, and I won't use inference requests to infer balance. If the endpoint is
already documented, a link and one example response would be enough. If it is
not available, I'll keep using manual snapshots.

Thanks,
[Name]
[Account email]

---

## Follow-up log

| Date | Vendor | Channel | Status | Response |
| --- | --- | --- | --- | --- |
| — | TokenHarbor | `hello@tokenharbor.ai` | Not sent | — |
| — | River AI | `river.ai/#contact` | Not sent | — |

When a vendor responds, record the exact endpoint, auth scheme, rate limits, and
sample payload here. Implement only against a documented contract and keep
manual entry as the fallback for accounts without access.
