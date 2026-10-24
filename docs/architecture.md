# Architecture

## Runtime topology

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ Next.js web process      │        │ Worker process           │
│  • RSC dashboard pages   │        │  • scheduler loop        │
│  • /api route handlers   │        │  • job claim (SKIP LOCKED)│
│  • auth + CSRF + rate    │        │  • adapter refresh       │
│    limiting              │        │  • retention purge       │
└────────────┬─────────────┘        └────────────┬─────────────┘
             │                                   │
             └──────────────┬────────────────────┘
                            ▼
                   ┌─────────────────┐
                   │  PostgreSQL 16  │
                   │  Prisma schema  │
                   └────────┬────────┘
                            ▼
              read-only provider endpoints
        (OpenCode Go, TokenHarbor, River AI,
               Command Code — optional)
```

The web and worker processes share only PostgreSQL. No Redis or message broker
is required. Multiple web instances and multiple worker lanes are safe because
job claiming is atomic and refresh jobs have a single-flight guarantee.

## Directory map

```
src/
  app/
    (auth)/login, (auth)/register        Server-rendered auth pages
    (app)/dashboard                      Overview (client sorting over server data)
    (app)/providers/new                  Add-provider flow
    (app)/providers/[id]                 Detail, history, diagnostics
    (app)/settings                       Account, retention, export, security
    api/auth/*                           Register/login/logout/session
    api/providers/*                      CRUD, refresh, credential, manual quota/credit
    api/settings/*                       Settings, password
    api/export                           JSON/CSV export
    api/health                           Liveness + DB check
  components/                            UI, forms, countdowns, actions
  lib/
    accounts.ts                          Ownership-aware account operations
    dashboard.ts                         Query + presentation mapping
    refresh.ts                           Queue, claim, execute, retry, classify
    retention.ts                         Per-user retention purge
    auth.ts                              Sessions, cookies, same-origin check
    crypto.ts                            AES-256-GCM credential envelopes
    password.ts                          scrypt hash/verify
    providers/
      types.ts                           Adapter contract + result envelope
      registry.ts                        Feature-gated adapter factory
      http.ts                            Timeout + bounded retry client
      parsing.ts                         Defensive parsing + quota derivation
      opencode-go/                       Percentage meters (experimental)
      commandcode/                       USD credit meters (experimental)
      tokenharbor/                       Key probe, manual metrics
      river-ai/                          Key probe, manual metrics
      output.ts                          Zod output validation
  worker/                                Long-running and one-shot entrypoints
prisma/
  schema.prisma                          Normalized data model
  migrations/                            SQL including partial unique index + checks
tests/                                   Unit, integration, fixtures
e2e/                                     Playwright mobile flow
```

## Data model decisions

- **UUID primary keys** for users, accounts, snapshots, jobs, and audit events.
- **UTC everywhere**: all timestamps are `timestamptz(6)`; display formatting
  happens at the edge with the user's IANA timezone.
- **Fixed-point decimals**: quota values and money use `numeric(30,10)`;
  percentages use `numeric(10,4)` constrained to 0–100. No binary floats in the
  database.
- **Snapshots are append-only observations**. The latest reading is derived at
  read time by window + model scope; older readings remain for history.
- **Units are explicit** (`TOKENS`, `REQUESTS`, `CREDITS`, `USD`, `PERCENT`,
  `PROVIDER_DEFINED`). There is no canonical conversion between them.
- **Credits are typed** (`WALLET`, `PROMOTIONAL`, `REWARD`, `INCLUDED_ALLOWANCE`,
  `OTHER`) so wallet money is never added to a subscription allowance.
- **Deduplication**:
  - One active refresh job per account via a partial unique index on
    `RefreshJob(providerAccountId) WHERE status IN ('PENDING','RUNNING')`.
  - Usage records dedupe on `(providerAccountId, externalId)` when a stable
    provider ID exists.
- **Foreign keys** cascade from users to accounts to observations/jobs. Audit
  events keep the user and null out a deleted account reference.
- **Check constraints** guard non-negative amounts and percent range.

## Refresh lifecycle

1. The scheduler inserts a `PENDING` job for every active, live account whose
   `nextRefreshAt` is due. The partial unique index silently skips accounts with
   an active job (`ON CONFLICT DO NOTHING`).
2. A worker claims the oldest due job atomically:
   `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`.
3. The adapter validates the credential, then fetches account/quota/credit
   data. Each adapter memoizes its upstream load so validation and reads share
   one HTTP request sequence.
4. Normalized output is re-validated with Zod and written in a transaction with
   the account status and job result.
5. Failure classification:
   - Invalid/expired credential, forbidden, unsupported → `NEEDS_ATTENTION`,
     no retry, scheduler pauses automatic retries until the key is replaced.
   - Rate limit, timeout, network, 5xx, malformed → `ERROR`, retry after
     5/10/20 minutes (or `Retry-After`), maximum three attempts.
6. Successful refreshes set `lastSyncedAt`, clear the error, and schedule the
   next attempt from the account's refresh interval.
7. Stuck `RUNNING` jobs older than 15 minutes are reset to `PENDING` on worker
   start/periodically.

Manual connections never enter the live queue. A manual snapshot is an explicit
user action and is stored with `source = MANUAL`.

## Adapter contract

```ts
interface ProviderAdapter {
  readonly providerId: ProviderKey;
  readonly capabilities: ProviderCapabilities;

  validateConnection(): Promise<AdapterResult<AccountSnapshot>>;
  getAccountSnapshot(): Promise<AdapterResult<AccountSnapshot>>;
  getQuotaSnapshots(): Promise<AdapterResult<QuotaSnapshotInput[]>>;
  getCreditSnapshots?(): Promise<AdapterResult<CreditSnapshotInput[]>>;
  getUsageHistory?(since: string): Promise<AdapterResult<UsageRecordInput[]>>;
}
```

`AdapterResult<T>` is a discriminated union: `{ ok: true, data, diagnostics }`
or `{ ok: false, error, diagnostics }`. Errors have a fixed code, optional HTTP
status and retry hint. Adapters never throw across the boundary; the refresh
service still wraps unknown failures.

Every adapter declares capabilities, so the UI can say "Not supported" rather
than displaying a fabricated zero. Provider folders are isolated so one vendor's
failure cannot affect another.

## Read path

Server components call `listAccounts` / `getAccountDetail`. These load recent
snapshots in descending order, keep the newest row per window + model scope +
unit, and compute:

- remaining percentage and lowest-window badge,
- freshness (live / stale / manual / never / error),
- primary credits by type,
- supported capability copy.

Client components only handle interaction (sorting, filters, countdowns, forms);
they receive no credentials. All API responses are `Cache-Control: no-store`.

## Retention

Per-user windows (defaults): quota/credit 90 days, usage 180 days, audit 365
days. Refresh jobs older than 30 days and expired sessions are removed. The
worker takes a PostgreSQL advisory lock and runs the purge every six hours.
Credits intentionally follow the quota retention window because they are
snapshots of the same billing state.

## Failure isolation

- Provider HTTP calls are per-account and caught individually.
- Experimental adapters can be disabled globally without affecting manual data.
- Audit writes never fail the user operation.
- Optional Command Code lookups (subscription/identity) degrade to diagnostics.
- The UI distinguishes "provider error" from "no data source" and from
  "manual entry".
