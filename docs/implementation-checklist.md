# Implementation checklist

Status legend: ✅ implemented and tested · 🟡 implemented with a known limitation
· ⬜ not started.

## M0 — Inspect and verify

- ✅ Inspected the working directory (empty repository; greenfield build).
- ✅ Selected the prescribed Next.js/PostgreSQL/Prisma stack.
- ✅ Researched all four providers from official docs.
- ✅ Documented verified, community-observed, and unsupported capabilities in
      `docs/provider-capability-matrix.md`.
- ✅ Recorded that OpenCode Go and Command Code quota routes are not documented
      public APIs and gated them behind `ENABLE_EXPERIMENTAL_ADAPTERS`.
- ✅ Recorded that TokenHarbor and River have no balance API and implemented a
      manual fallback.
- 🟡 No real vendor credentials were available, so live parsers are
      contract-tested with synthetic fixtures rather than account-tested.

## M1 — Architecture and foundation

- ✅ Next.js 15 + React 19 + strict TypeScript.
- ✅ Tailwind CSS and accessible custom components.
- ✅ PostgreSQL + Prisma schema and migrations.
- ✅ Environment validation with Zod.
- ✅ Route handlers for the authenticated API.
- ✅ Separate background worker with PostgreSQL-backed queueing.
- ✅ Server-managed sessions and scrypt passwords.
- ✅ Vitest unit + integration suites; Playwright mobile E2E.
- ✅ PWA manifest, offline shell, service worker.
- ✅ Capacitor config and deployment instructions.
- ✅ CI workflow.

## M2 — Data model

- ✅ User, ProviderAccount, QuotaSnapshot, CreditSnapshot, UsageRecord,
      RefreshJob, AuditEvent, Session.
- ✅ UUIDs, UTC timestamps, fixed-point decimals, foreign keys, indexes.
- ✅ Historical quota snapshots.
- ✅ Single-flight refresh jobs via a partial unique index.
- ✅ Usage dedupe by `(providerAccountId, externalId)`.
- ✅ Encrypted credentials with key version; no raw credentials in jobs/audit.
- ✅ Per-user retention policies with a worker purge.
- ✅ Check constraints for percent range and non-negative values.

## M3 — Provider adapters

- ✅ Typed adapter contract and discriminated result envelope.
- ✅ Runtime output validation (Zod) before persistence.
- ✅ Request timeouts, bounded retries, 429/5xx handling, auth error mapping.
- ✅ Provider modules: `opencode-go`, `tokenharbor`, `river-ai`, `commandcode`.
- ✅ Missing values remain `null`; unsupported capabilities are explicit.
- ✅ Manual quota and credit snapshots with source labels.
- ✅ Failures isolated per account; experimental adapters feature-gated.
- ✅ Read-only requests only; no inference calls, scraping, or cookies.
- ✅ Optional OpenAI/Anthropic-compatible usage gateway for TokenHarbor and
      River, with streaming usage capture, public-list-price estimates, and
      estimated balance/weekly snapshots.
- 🟡 Usage-history method exists in the contract but no provider exposes a
      per-record API today. Gateway records cover proxied traffic only.

## M4 — Dashboard and UI

- ✅ Minimal mobile-first dashboard: provider name plus three quota-used bars
      (5-hour, weekly, monthly) or credits left, with both shown when available.
- ✅ Inline "Add balance" entry for probe-only providers, with a manual-tracking
      state until data is recorded.
- ✅ Inline two-window weekly usage entry for TokenHarbor Office Pass
      (paid-model and free-model bars).
- ✅ Persistent one-tap update links on manual cards, prefilled with current
      values, with a 7-day update-due flag.
- ✅ TokenHarbor billing CSV import on the provider page: parses the official
      ledger locally and saves the latest running balance as a manual wallet
      snapshot. Office Pass usage is explicitly excluded.
- ✅ Full detail (freshness, countdowns, labels, breakdowns) on provider pages.
- ✅ Credit balances separated by type and currency.
- ✅ Per-window remaining percentage, progress, countdown, absolute reset.
- ✅ Last sync, freshness, stale/error states, manual labels.
- ✅ Refresh action with typed error feedback.
- ✅ Provider detail: breakdown, history, capabilities, diagnostics, credential
      replacement, manual entry, pause, disconnect.
- ✅ Settings: profile, timezone, refresh cadence, retention, export, password,
      session revocation.
- ✅ Empty states and explicit "Not supported" / "Reset time unavailable"
      copy.
- ✅ PWA installability and offline fallback.
- ✅ No demo data in production paths.
- ✅ Gateway token creation, rotation, revocation, per-account base URLs, and
      recent proxied activity with estimated cost.
- ✅ Gateway estimates re-derive from the latest real anchor, so manual
      corrections are not double-charged.

## Remaining work before a broad public launch

- ⬜ Validate the OpenCode Go and Command Code parsers against real accounts.
- ⬜ Validate gateway usage capture against live TokenHarbor and River streams.
- ⬜ Add a nonce-based Content-Security-Policy at the proxy/middleware.
- ⬜ Add email verification and password reset.
- ⬜ Add a per-device session inventory.
- ⬜ Add Web Push reset/limit alerts.
- ⬜ Build and sign the Android artifact; verify on device.
- ⬜ Exercise the app with a screen reader and on iOS Safari.
- ⬜ Add shared rate limiting for multi-instance deployment.
- ⬜ Add end-to-end tests for live adapters against a mock HTTP server.
