import Link from "next/link";
import type { AccountView, QuotaView } from "@/lib/dashboard";
import { primaryCredit, summaryWindows } from "@/lib/dashboard-summary";
import { manualUpdateState, type ManualUpdateState } from "@/lib/manual-updates";
import {
  formatMetric,
  formatMoney,
  USAGE_BAND_COLORS,
  usageBand,
  usagePercentFromQuota,
} from "@/lib/quota";
import { Icon } from "./icons";
import { QuickBalanceForm } from "./QuickBalanceForm";
import { QuickQuotaForm } from "./QuickQuotaForm";
import { EmptyState, ProgressBar } from "./ui";

export function DashboardView({ accounts }: { accounts: AccountView[] }) {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
        Quota at a glance
      </h1>

      {accounts.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No providers connected yet"
            body="Add a provider to start tracking quota and credits."
            action={
              <Link href="/providers/new" className="btn-primary">
                <Icon name="plus" className="h-4 w-4" />
                Add your first provider
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {accounts.map((account) => (
            <ProviderSummary key={account.id} account={account} />
          ))}
        </div>
      )}
    </>
  );
}

function ProviderSummary({ account }: { account: AccountView }) {
  const windows = summaryWindows(account.quota);
  const credit = primaryCredit(account.credits);
  const positiveQuotaUsd = windows.some(
    ({ quota }) => quota.unit === "usd" && quota.remaining !== null && quota.remaining > 0,
  );
  const displayCredit = credit && credit.amount === 0 && positiveQuotaUsd ? null : credit;
  const manual = account.provider === "TOKENHARBOR" || account.provider === "RIVER_AI";
  const showUsageAction = account.provider === "TOKENHARBOR";
  const usageObservedAt = account.quota.reduce<string | null>((latest, row) => {
    if (row.window !== "weekly") return latest;
    if (row.modelScope !== "Paid models" && row.modelScope !== "Free models") return latest;
    if (!latest) return row.observedAt;
    return new Date(row.observedAt).getTime() > new Date(latest).getTime()
      ? row.observedAt
      : latest;
  }, null);
  const usageUpdate = manualUpdateState(usageObservedAt);
  const balanceUpdate = manualUpdateState(credit?.observedAt ?? null);
  const updateDue = manual && ((showUsageAction && usageUpdate.due) || balanceUpdate.due);
  const attention = attentionFor(account, updateDue);
  const statusParts: string[] = [];
  if (showUsageAction) statusParts.push(statusLine("Usage", usageUpdate));
  statusParts.push(statusLine("Balance", balanceUpdate));
  const initialUsage: Partial<Record<"Paid models" | "Free models", number | null>> = {};

  for (const entry of windows) {
    if (entry.quota.window !== "weekly") continue;
    if (entry.quota.modelScope === "Paid models" || entry.quota.modelScope === "Free models") {
      initialUsage[entry.quota.modelScope] = usagePercentFromQuota(entry.quota);
    }
  }

  if (windows.length === 0 && !credit) {
    return (
      <article className="card p-4">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            <Link href={`/providers/${account.id}`} className="hover:text-slate-700">
              {account.displayName}
            </Link>
          </h2>
          <Icon
            name="chevron-right"
            className="h-3.5 w-3.5 shrink-0 text-slate-400"
          />
          <AttentionDot attention={attention} />
        </div>

        <p className="mt-1 text-xs leading-relaxed text-slate-500">{manualNote(account)}</p>

        {account.provider === "TOKENHARBOR" ? (
          <QuickQuotaForm accountId={account.id} />
        ) : null}

        <QuickBalanceForm accountId={account.id} />

        {account.capabilities.quotaWindows.length > 0 ? (
          <Link
            href={`/providers/${account.id}#manual`}
            className="mt-2 block text-center text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
          >
            Add a quota window instead
          </Link>
        ) : null}
      </article>
    );
  }

  return (
    <article className="card overflow-hidden">
      <Link
        href={`/providers/${account.id}`}
        className="block p-4 transition hover:bg-slate-50/60"
      >
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {account.displayName}
          </h2>
          <AttentionDot attention={attention} />
        </div>

        {windows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {windows.map(({ key, label, quota }) => (
              <SummaryBar
                key={`${key}-${quota.modelScope ?? ""}`}
                label={label}
                quota={quota}
              />
            ))}
          </div>
        ) : null}

        {displayCredit ? (
          <div
            className={`flex items-baseline justify-between gap-3 ${
              windows.length > 0 ? "mt-3 border-t border-slate-100 pt-3" : "mt-3"
            }`}
          >
            <span className="text-xs text-slate-500">Credits left</span>
            <span className="text-base font-semibold tabular-nums text-slate-900">
              {formatMoney(displayCredit.amount, displayCredit.currency)}
            </span>
          </div>
        ) : null}
      </Link>

      {manual ? (
        <div className="border-t border-slate-100 px-4 pb-3 pt-2">
          <span
            className={`text-[11px] ${
              updateDue ? "font-medium text-amber-600" : "text-slate-400"
            }`}
          >
            {statusParts.join(" · ")}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-x-4">
            {showUsageAction ? (
              <QuickQuotaForm
                accountId={account.id}
                variant="inline"
                initialValues={initialUsage}
              />
            ) : null}
            <QuickBalanceForm
              accountId={account.id}
              variant="inline"
              triggerLabel={credit ? undefined : "Add balance"}
              initialAmount={credit?.amount}
              initialType={credit?.creditType}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function statusLine(name: string, state: ManualUpdateState): string {
  if (state.ageDays === null) return `${name} not added`;
  return `${name} ${state.label.toLowerCase()}${state.due ? " (due)" : ""}`;
}

function attentionFor(
  account: AccountView,
  updateDue = false,
): { dot: string; label: string } | null {
  if (account.freshness.kind === "error") {
    return { dot: "bg-rose-500", label: account.freshness.label };
  }
  if (account.freshness.kind === "stale") {
    return { dot: "bg-amber-500", label: account.freshness.label };
  }
  if (updateDue) {
    return { dot: "bg-amber-500", label: "Manual update due" };
  }
  return null;
}

function AttentionDot({
  attention,
}: {
  attention: { dot: string; label: string } | null;
}) {
  if (!attention) return null;
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${attention.dot}`}
      role="img"
      aria-label={attention.label}
      title={attention.label}
    />
  );
}

function manualNote(account: AccountView): string {
  if (account.freshness.kind === "error") {
    return "Connection needs attention · add data manually";
  }
  if (account.provider === "TOKENHARBOR") {
    return "Office Pass · usage and balance are manual";
  }
  if (account.provider === "RIVER_AI") {
    return "Credit · add your current balance";
  }
  if (account.authMode === "MANUAL") {
    return "Manual tracking · no data yet";
  }
  if (account.capabilities.quotaWindows.length === 0 && !account.capabilities.creditBalance) {
    return "Key connected · balances are manual";
  }
  return "No data yet · add manually";
}

function SummaryBar({ label, quota }: { label: string; quota: QuotaView }) {
  const usedPercent = usagePercentFromQuota(quota);
  const colors = USAGE_BAND_COLORS[usageBand(usedPercent)];

  if (usedPercent === null && quota.remaining !== null && quota.unit !== "percent") {
    return (
      <div className="flex items-center gap-2.5">
        <span
          title={label}
          className="w-20 shrink-0 truncate text-[11px] font-medium text-slate-500"
        >
          {label}
        </span>
        <span className="flex-1 text-right text-[11px] text-slate-400">remaining</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-900">
          {formatMetric(quota.remaining, quota.unit)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <span
        title={label}
        className="w-20 shrink-0 truncate text-[11px] font-medium text-slate-500"
      >
        {label}
      </span>
      <div className="flex-1">
        <ProgressBar usedPercent={usedPercent} label={`${label} quota used`} />
      </div>
      <span
        className={`w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums ${colors.text}`}
      >
        {usedPercent === null ? "—" : `${Math.round(usedPercent)}%`}
      </span>
    </div>
  );
}
