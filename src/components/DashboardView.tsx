"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AccountView, QuotaView } from "@/lib/dashboard";
import {
  BAND_COLORS,
  formatMoney,
  formatPercent,
  remainingBand,
  windowLabel,
} from "@/lib/quota";
import { Countdown } from "./Countdown";
import { Icon } from "./icons";
import { RefreshButton } from "./RefreshButton";
import { RelativeTime } from "./RelativeTime";
import {
  CREDIT_LABELS,
  EmptyState,
  FreshnessPill,
  QuotaLine,
  StatusPill,
} from "./ui";

const AVATAR: Record<string, string> = {
  OPENCODE_GO: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  TOKENHARBOR: "bg-teal-50 text-teal-700 ring-teal-100",
  RIVER_AI: "bg-sky-50 text-sky-700 ring-sky-100",
  COMMANDCODE: "bg-amber-50 text-amber-700 ring-amber-100",
};

type SortMode = "risk" | "recent" | "name";
type FilterMode = "all" | "live" | "manual" | "attention";

const SORT_LABELS: Record<SortMode, string> = {
  risk: "Lowest remaining",
  recent: "Recently updated",
  name: "Name",
};

const FILTERS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "manual", label: "Manual" },
  { key: "attention", label: "Needs attention" },
];

export function DashboardView({
  accounts,
  totals,
  timezone,
}: {
  accounts: AccountView[];
  totals: {
    accounts: number;
    healthy: number;
    needsAttention: number;
    manual: number;
    neverSynced: number;
    lowest: number | null;
  };
  timezone: string;
}) {
  const [sort, setSort] = useState<SortMode>("risk");
  const [filter, setFilter] = useState<FilterMode>("all");

  const visible = useMemo(() => {
    const filtered = accounts.filter((account) => {
      if (filter === "live") return account.authMode === "LIVE";
      if (filter === "manual") return account.authMode === "MANUAL";
      if (filter === "attention") return account.freshness.kind === "error" || account.freshness.kind === "stale";
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.displayName.localeCompare(b.displayName);
      if (sort === "recent") {
        return (
          new Date(b.latestObservationAt ?? 0).getTime() -
          new Date(a.latestObservationAt ?? 0).getTime()
        );
      }
      const aRisk = a.lowest?.percent ?? 101;
      const bRisk = b.lowest?.percent ?? 101;
      return aRisk - bRisk || a.displayName.localeCompare(b.displayName);
    });
  }, [accounts, filter, sort]);

  const globalLowest = useMemo(() => {
    let found: { percent: number; account: AccountView; quota: QuotaView } | null = null;
    for (const account of accounts) {
      for (const quota of account.quota) {
        if (quota.remainingPercent === null) continue;
        if (!found || quota.remainingPercent < found.percent) {
          found = { percent: quota.remainingPercent, account, quota };
        }
      }
    }
    return found;
  }, [accounts]);

  if (accounts.length === 0) {
    return (
      <>
        <Header totals={totals} />
        <div className="mt-8">
          <EmptyState
            title="No providers connected yet"
            body="Connect OpenCode Go, TokenHarbor, River AI, or Command Code. Live quota is used where the vendor supports it; everything else can be tracked manually."
            action={
              <Link href="/providers/new" className="btn-primary">
                <Icon name="plus" className="h-4 w-4" />
                Add your first provider
              </Link>
            }
          />
        </div>
        <DataHonestyNote />
      </>
    );
  }

  return (
    <>
      <Header totals={totals} />

      {globalLowest && globalLowest.percent <= 25 ? (
        <div
          className={`mt-6 flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
            globalLowest.percent <= 10
              ? "border-rose-200 bg-rose-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <Icon
              name="alert"
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                globalLowest.percent <= 10 ? "text-rose-600" : "text-amber-600"
              }`}
            />
            <p className={`text-sm ${globalLowest.percent <= 10 ? "text-rose-800" : "text-amber-800"}`}>
              <span className="font-semibold">
                {formatPercent(globalLowest.percent)} left
              </span>{" "}
              on {globalLowest.account.displayName} ·{" "}
              {windowLabel(globalLowest.quota.window)}
              {globalLowest.quota.modelScope ? ` (${globalLowest.quota.modelScope})` : ""}.{" "}
              <Link href={`/providers/${globalLowest.account.id}`} className="underline underline-offset-2">
                View details
              </Link>
            </p>
          </div>
          <div className="text-xs font-medium text-slate-600">
            <Countdown target={globalLowest.quota.resetsAt} />
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter providers">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filter === item.key
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-xs font-medium text-slate-500">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
            className="input w-auto py-1.5 text-xs"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          No providers match this filter.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {visible.map((account) => (
            <ProviderCard key={account.id} account={account} timezone={timezone} />
          ))}
        </div>
      )}

      <DataHonestyNote />
    </>
  );
}

function Header({ totals }: { totals: { accounts: number; healthy: number; needsAttention: number; manual: number; lowest: number | null } }) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Overview
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Quota at a glance
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Remaining allowance, balances, and reset countdowns across every connected provider.
          </p>
        </div>
        <Link href="/providers/new" className="btn-primary self-start sm:self-auto">
          <Icon name="plus" className="h-4 w-4" />
          Add provider
        </Link>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Providers" value={String(totals.accounts)} />
        <Stat
          label="Lowest remaining"
          value={totals.lowest !== null ? formatPercent(totals.lowest) : "—"}
          tone={
            totals.lowest === null
              ? undefined
              : totals.lowest <= 10
                ? "critical"
                : totals.lowest <= 25
                  ? "warn"
                  : "good"
          }
        />
        <Stat
          label="Needs attention"
          value={String(totals.needsAttention)}
          tone={totals.needsAttention > 0 ? "critical" : undefined}
        />
        <Stat label="Manual tracking" value={String(totals.manual)} />
      </dl>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "critical";
}) {
  const color =
    tone === "critical"
      ? "text-rose-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "good"
          ? "text-emerald-700"
          : "text-slate-900";
  return (
    <div className="card px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

function ProviderCard({ account, timezone }: { account: AccountView; timezone: string }) {
  const lowest = account.lowest;
  const band = remainingBand(lowest?.percent ?? null);
  const bandColor = BAND_COLORS[band];
  const quotaShown = account.quota.slice(0, 4);
  const hiddenQuota = account.quota.length - quotaShown.length;
  const creditsShown = account.credits.slice(0, 3);

  return (
    <article className="card flex flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1 ring-inset ${
              AVATAR[account.provider] ?? "bg-slate-50 text-slate-600 ring-slate-100"
            }`}
            aria-hidden="true"
          >
            {account.providerName
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold text-slate-900">
                {account.displayName}
              </h2>
              <StatusPill status={account.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {account.providerName}
              {account.planName ? ` · ${account.planName}` : ""}
              {account.accountLabel ? ` · ${account.accountLabel}` : ""}
            </p>
          </div>
        </div>

        {lowest ? (
          <span className={`badge shrink-0 ${bandColor.badge}`} title="Lowest supported window">
            {bandColor.label}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <FreshnessPill account={account} />
        {!account.isActive ? (
          <span className="badge bg-slate-100 text-slate-600 ring-slate-200">Paused</span>
        ) : null}
      </div>

      {creditsShown.length > 0 ? (
        <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5">
          {creditsShown.map((credit) => (
            <div key={credit.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-xs text-slate-500">
                {CREDIT_LABELS[credit.creditType] ?? credit.creditType}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatMoney(credit.amount, credit.currency)}
              </span>
            </div>
          ))}
          {account.credits.length > creditsShown.length ? (
            <p className="text-[11px] text-slate-400">
              +{account.credits.length - creditsShown.length} more in details
            </p>
          ) : null}
        </div>
      ) : null}

      {quotaShown.length > 0 ? (
        <div className="mt-4 space-y-4">
          {quotaShown.map((quota) => (
            <QuotaLine key={quota.id} quota={quota} timezone={timezone} />
          ))}
          {hiddenQuota > 0 ? (
            <p className="text-[11px] text-slate-400">+{hiddenQuota} more quota windows in details</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
          <p className="text-xs font-semibold text-slate-700">No live quota values</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {account.capabilityNotes[1] ?? account.capabilityNotes[0] ?? "This provider does not publish a quota API."}
          </p>
          <Link
            href={`/providers/${account.id}#manual`}
            className="mt-2 inline-flex text-[11px] font-semibold text-slate-700 underline underline-offset-2"
          >
            Add a manual snapshot
          </Link>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="text-[11px] text-slate-400">
          Updated <RelativeTime value={account.latestObservationAt} />
        </p>
        <div className="flex items-center gap-1">
          {account.authMode === "LIVE" ? <RefreshButton accountId={account.id} compact /> : null}
          <Link
            href={`/providers/${account.id}`}
            className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Details
            <Icon name="chevron-right" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function DataHonestyNote() {
  return (
    <p className="mt-8 flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
      <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      Values are shown only when a provider or manual entry supplies them. Missing metrics are
      labeled unavailable, never replaced with zero. Live readings can lag the provider console by
      one refresh interval.
    </p>
  );
}


