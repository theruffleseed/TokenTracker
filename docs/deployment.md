# Deployment

## Production checklist

- [ ] Managed PostgreSQL 15/16 with automated backups and TLS.
- [ ] `DATABASE_URL` points at the production database.
- [ ] `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` generated with
      `npm run keys:generate` and stored in a secret manager.
- [ ] `APP_URL` is the exact HTTPS origin.
- [ ] `SESSION_COOKIE_SECURE=true`.
- [ ] `ALLOW_REGISTRATION=false` unless public sign-up is intended.
- [ ] `ENABLE_EXPERIMENTAL_ADAPTERS` explicitly chosen (default `false`).
- [ ] Migrations applied with `npm run db:deploy`.
- [ ] Web process and worker process both deployed.
- [ ] HTTPS/reverse proxy configured; trusted proxy headers set.
- [ ] Health check wired to `/api/health`.
- [ ] Logs shipped and retained.
- [ ] Restore drill performed for the database backup.

## Build and start

```bash
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy
npm start            # web
npm run worker       # separate service, never inside the web process
```

`npm run build` runs strict TypeScript and ESLint. Migrations are not run
automatically by the app; run them as a release step.

## Worker deployment

The worker is a long-running Node process. It needs the same environment and
database access as the web app, but no public port.

Options:

- **Render/Railway/Fly.io/Kubernetes:** run `npm run worker` as a worker
  service with restart-on-failure.
- **Cron platform:** run `npm run worker:once` every few minutes. It claims all
  due jobs (bounded to 50), applies retention, and exits. Set the schedule to at
  least as often as the shortest account refresh interval.
- **Vercel:** deploy the Next.js app there, but run the worker on a separate
  host. Do not try to keep the loop alive in a serverless function. Alternatively
  call a protected cron route that runs `worker:once` logic; that route is not
  included here because it would need its own authentication design.

Multiple worker instances are supported. Claiming uses
`FOR UPDATE SKIP LOCKED`, and the database enforces one active job per account.

## Reverse proxy notes

- Terminate TLS at the proxy and forward `Host`, `X-Forwarded-For`,
  `X-Forwarded-Proto`.
- Ensure `Origin` reaches the app; same-origin checks rely on it when present.
- Set a request timeout of at least 60 seconds for `/api/providers/:id/refresh`
  when `INLINE_REFRESH=true`. Set `INLINE_REFRESH=false` to make the endpoint
  return immediately after queueing.
- Do not cache authenticated HTML or API responses. The app sets
  `Cache-Control: no-store`; the service worker never caches API responses.
- Add a nonce-based CSP at this layer (see `docs/security.md`).

## Scaling

- Web and worker are stateless apart from PostgreSQL.
- The in-process rate limiter is per instance; add a shared limiter at the edge
  or a Redis-backed implementation before horizontal scaling.
- Poll interval and worker concurrency are environment-tunable. Each provider
  account adds at most one upstream GET per refresh cycle (OpenCode Go: one;
  Command Code: up to three, with two optional).
- Snapshot growth is bounded by retention. Estimate ~48 rows/account/day at a
  30-minute cadence; 90 days ≈ 4,300 rows/account.

## PWA

The app ships:

- `/manifest.webmanifest` with 192/512/maskable icons.
- A production-only service worker that caches the offline shell and static
  assets. It explicitly refuses to cache `/api/*` and authenticated HTML.
- `/offline` fallback.

No push notifications or background sync are implemented.

## Capacitor Android wrapper

The web app is server-rendered, so the Android shell loads the deployed origin
instead of bundled static HTML.

```bash
# 1. Point the shell at your HTTPS deployment
export CAPACITOR_SERVER_URL="https://your-domain.example"

# 2. Add the Android platform (requires Android Studio / SDK)
npm run cap:add:android
npm run cap:sync

# 3. Open in Android Studio and build the APK/AAB
npx cap open android
```

`capacitor.config.ts` sets `webDir: "public"` and uses
`CAPACITOR_SERVER_URL`. For local cleartext development only, `cleartext` is
enabled when `NODE_ENV !== "production"`. Use HTTPS in production and configure
the Android network security policy accordingly.

## Health and monitoring

- `GET /api/health` returns `200` when PostgreSQL is reachable and `503`
  otherwise. It exposes no secrets or account data.
- Worker logs one line per claimed job and per failure. Ship stdout to your log
  platform.
- Recommended alerts: health check failures, worker process restarts, refresh
  jobs stuck `RUNNING` for more than 15 minutes, and repeated
  `MALFORMED_RESPONSE` / `PROVIDER_UNAVAILABLE` codes.

## Backups and recovery

- Use managed automated backups plus point-in-time recovery where available.
- Back up the database and the credential encryption key separately. Losing the
  key makes stored provider credentials unrecoverable (users must re-enter them).
- Test restoring into a staging database and run `npm run db:deploy` plus the
  worker in one-shot mode.

## Upgrades

1. Back up the database.
2. Deploy the new web/worker image but keep old processes draining.
3. Run `npm run db:deploy`.
4. Restart the worker, then the web app.
5. Verify `/api/health`, a manual refresh, and a scheduled job.

Experimental provider parsers should be re-checked against the capability matrix
after upgrading; they fail closed if upstream shapes change.
