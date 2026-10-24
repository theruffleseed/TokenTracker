import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAccountDetail } from "@/lib/dashboard";
import {
  BAND_COLORS,
  formatDateTime,
  formatMetric,
  formatMoney,
  formatPercent,
  remainingBand,
} from "@/lib/quota";
import { Icon } from "@/components/icons";
import { ProviderActions } from "@/components/ProviderActions";
import { ManualForms } from "@/components/ManualForms";
import { ConnectionSettings } from "@/components/ConnectionSettings";
import { RelativeTime } from "@/components/RelativeTime";
import {
  CREDIT_LABELS,
  CreditLine,
  FreshnessPill,
  QuotaLine,
  SourceBadge,
  StatusPill,
} from "@/components/ui";

export const metadata: Metadata = { title: "Provider details" };
export const dynamic = "force-dynamic";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const account = await getAccountDetail(user.id, id);
  if (!account) notFound();

  const band = remainingBand(account.lowest?.percent ?? null);
  const colors = BAND_COLORS[band];
  const primaryCredit = account.credits[0] ?? null;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          <Icon name="chevron-left" className="h-3.5 w-3.5" />
          Back to overview
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {account.displayName}
            </h1>
            <StatusPill status={account.status} />
            {!account.isActive ? (
              <span className="badge bg-slate-100 text-slate-600 ring-slate-200">Paused</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-slate-500">
            {account.providerName}
            {account.planName ? ` · ${account.planName}` : ""}
            {account.accountLabel ? ` · ${account.accountLabel}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <FreshnessPill account={account} />
            <span className="badge bg-slate-100 text-slate-600 ring-slate-200">
              {account.authMode === "LIVE" ? "Live connection" : "Manual tracking"}
            </span>
            <a
              href={account.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900"
            >
              Provider docs
              <Icon name="external" className="h-3 w-3" />
            </a>
          </div>
        </div>

        <ProviderActions
          accountId={account.id}
          isActive={account.isActive}
          authMode={account.authMode}
        />
      </div>

      {account.lastErrorCode ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <p className="text-sm font-semibold text-rose-800">
                Last refresh failed · {account.lastErrorCode}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-rose-700">
                {account.lastErrorMessage ?? "No diagnostic was recorded."}
              </p>
              {["INVALID_CREDENTIALS", "EXPIRED_CREDENTIALS", "FORBIDDEN", "NOT_CONFIGURED"].includes(
                account.lastErrorCode,
              ) ? (
                <p className="mt-1 text-xs text-rose-700">
                  Replace the API key below, then run a refresh.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DetailStat
          label="Lowest remaining"
          value={account.lowest ? formatPercent(account.lowest.percent) : "—"}
          sub={account.lowest ? `${account.lowest.modelScope ?? "Account-wide"}` : "No percent metric"}
          valueClass={colors.text}
        />
        <DetailStat
          label="Balance"
          value={primaryCredit ? formatMoney(primaryCredit.amount, primaryCredit.currency) : "—"}
          sub={primaryCredit ? CREDIT_LABELS[primaryCredit.creditType] ?? primaryCredit.creditType : "Not reported"}
        />
        <DetailStat
          label="Last updated"
          value={<RelativeTime value={account.latestObservationAt} />}
          sub={account.latestObservationAt ? formatDateTime(account.latestObservationAt, user.timezone) : "No observations"}
        />
        <DetailStat
          label="Next refresh"
          value={
            account.authMode === "MANUAL"
              ? "Manual"
              : account.nextRefreshAt
                ? formatDateTime(account.nextRefreshAt, user.timezone)
                : "Not scheduled"
          }
          sub={
            account.authMode === "MANUAL"
              ? "No automatic refresh"
              : `Every ${account.refreshIntervalMin} min`
          }
        />
      </dl>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Current quota</h2>
              <span className="text-[11px] text-slate-400">
                {account.quota.length} supported window{account.quota.length === 1 ? "" : "s"}
              </span>
            </div>

            {account.quota.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {account.quota.map((quota) => {
                  const quotaBand = remainingBand(quota.remainingPercent);
                  return (
                    <div key={quota.id} className="rounded-xl border border-slate-200 p-3.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <SourceBadge source={quota.source} />
                        <span className={`text-[11px] font-semibold ${BAND_COLORS[quotaBand].text}`}>
                          {BAND_COLORS[quotaBand].label}
                        </span>
                      </div>
                      <QuotaLine quota={quota} timezone={user.timezone} />
                      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                        <span>Observed {formatDateTime(quota.observedAt, user.timezone)}</span>
                        <span>{formatMetric(quota.used, quota.unit)} used</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5">
                <p className="text-sm font-medium text-slate-700">No live quota source</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {account.capabilityNotes[0] ??
                    "This provider does not publish quota data through an API."}{" "}
                  Add a manual quota snapshot below to track a window.
                </p>
                <a href="#manual" className="btn-secondary mt-3 inline-flex">
                  <Icon name="plus" className="h-4 w-4" />
                  Add manual quota
                </a>
              </div>
            )}
          </section>

          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Credits & balances</h2>
              <span className="text-[11px] text-slate-400">Monetary values, never mixed with tokens</span>
            </div>

            {account.credits.length > 0 ? (
              <div className="mt-4 space-y-2">
                {account.credits.map((credit) => (
                  <div key={credit.id} className="rounded-xl border border-slate-200 px-3.5 py-3">
                    <CreditLine credit={credit} />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <SourceBadge source={credit.source} />
                      <span className="text-[11px] text-slate-400">
                        {formatDateTime(credit.observedAt, user.timezone)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-slate-50 px-4 py-4 text-xs leading-relaxed text-slate-500">
                No balance has been reported for this connection. Add one manually below if the
                provider shows a monetary balance in its console.
              </p>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Manual snapshots</h2>
                <p className="text-xs text-slate-500">
                  Record what the provider console shows. Entries are labeled Manual.
                </p>
              </div>
            </div>
            <ManualForms accountId={account.id} />
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Quota observation history</h2>
              <span className="text-[11px] text-slate-400">{account.quotaHistory.length} stored</span>
            </div>
            {account.quotaHistory.length > 0 ? (
              <div className="table-wrap rounded-none border-0">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Observed</th>
                      <th>Window</th>
                      <th>Scope</th>
                      <th>Limit</th>
                      <th>Used</th>
                      <th>Remaining</th>
                      <th>Remaining %</th>
                      <th>Resets</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.quotaHistory.slice(0, 40).map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.observedAt, user.timezone)}</td>
                        <td className="capitalize">{row.window.replace("_", " ")}</td>
                        <td>{row.modelScope ?? "Account"}</td>
                        <td>{row.limit === null ? "—" : formatMetric(row.limit, row.unit)}</td>
                        <td>{row.used === null ? "—" : formatMetric(row.used, row.unit)}</td>
                        <td>{row.remaining === null ? "—" : formatMetric(row.remaining, row.unit)}</td>
                        <td>{formatPercent(row.remainingPercent)}</td>
                        <td>{row.resetsAt ? formatDateTime(row.resetsAt, user.timezone) : "Unavailable"}</td>
                        <td>
                          <SourceBadge source={row.source} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-6 text-xs text-slate-500">No quota observations yet.</p>
            )}
            {account.quotaHistory.length > 40 ? (
              <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400">
                Showing the 40 most recent observations. Export for the full history.
              </p>
            ) : null}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Credit history</h2>
              </div>
              {account.creditHistory.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {account.creditHistory.slice(0, 12).map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-xs font-medium text-slate-700">
                          {CREDIT_LABELS[row.creditType] ?? row.creditType}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatDateTime(row.observedAt, user.timezone)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatMoney(row.amount, row.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-xs text-slate-500">No credit observations yet.</p>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Recent refresh jobs</h2>
              </div>
              {account.jobs.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {account.jobs.slice(0, 8).map((job) => (
                    <li key={job.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700">{job.status}</span>
                        <span className="text-[11px] text-slate-400">
                          {formatDateTime(job.scheduledAt, user.timezone)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {job.trigger} · attempt {job.attemptCount}
                        {job.errorCode ? ` · ${job.errorCode}` : ""}
                        {job.finishedAt ? ` · finished ${formatDateTime(job.finishedAt, user.timezone)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-xs text-slate-500">
                  {account.authMode === "LIVE" ? "No refresh jobs yet." : "Manual connections do not run refresh jobs."}
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Capabilities</h2>
            <ul className="mt-3 space-y-2 text-xs">
              <li className="flex items-start justify-between gap-2">
                <span className="text-slate-500">Live quota</span>
                <span className="text-right font-medium text-slate-700">
                  {account.capabilities.quotaWindows.length > 0
                    ? account.capabilities.quotaWindows.map((window) => window.replace("_", " ")).join(", ")
                    : "Not supported"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Credit balance</span>
                <span className="font-medium text-slate-700">
                  {account.capabilities.creditBalance ? "Live" : "Manual only"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Usage history</span>
                <span className="font-medium text-slate-700">
                  {account.capabilities.usageHistory ? "Supported" : "Not available"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Model-specific limits</span>
                <span className="font-medium text-slate-700">
                  {account.capabilities.modelScopes ? "Supported" : "Not available"}
                </span>
              </li>
            </ul>

            {account.capabilities.experimental ? (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                This provider&apos;s quota route is not part of its documented public API. Parsing is
                defensive; failures surface as diagnostics instead of guessed values.
              </p>
            ) : null}

            <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">
              {account.capabilityNotes.map((note) => (
                <li key={note} className="flex gap-2 text-[11px] leading-relaxed text-slate-500">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  {note}
                </li>
              ))}
            </ul>
          </section>

          <ConnectionSettings
            accountId={account.id}
            displayName={account.displayName}
            planName={account.planName}
            accountLabel={account.accountLabel}
            refreshIntervalMin={account.refreshIntervalMin}
            authMode={account.authMode}
            credentialHint={account.credentialHint}
          />

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Connection diagnostics</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Mode</dt>
                <dd className="font-medium text-slate-700">{account.authMode}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Last successful sync</dt>
                <dd className="font-medium text-slate-700">
                  {account.lastSyncedAt ? formatDateTime(account.lastSyncedAt, user.timezone) : "Never"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Next scheduled</dt>
                <dd className="font-medium text-slate-700">
                  {account.nextRefreshAt ? formatDateTime(account.nextRefreshAt, user.timezone) : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Stored key</dt>
                <dd className="font-mono font-medium text-slate-700">
                  {account.authMode === "LIVE" ? account.credentialHint ?? "stored" : "none"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Created</dt>
                <dd className="font-medium text-slate-700">
                  {formatDateTime(account.createdAt, user.timezone)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Audit log</h2>
            </div>
            {account.audit.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {account.audit.map((event) => (
                  <li key={event.id} className="px-5 py-3">
                    <p className="text-[11px] font-semibold text-slate-700">{event.eventType}</p>
                    <p className="text-[11px] text-slate-400">
                      {formatDateTime(event.createdAt, user.timezone)}
                    </p>
                    {event.metadata && Object.keys(event.metadata as object).length > 0 ? (
                      <code className="mt-1 block break-all text-[10px] leading-relaxed text-slate-400">
                        {JSON.stringify(event.metadata)}
                      </code>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-xs text-slate-500">No audit events yet.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function DetailStat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 truncate text-lg font-semibold tabular-nums ${valueClass ?? "text-slate-900"}`}>
        {value}
      </dd>
      <p className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}
