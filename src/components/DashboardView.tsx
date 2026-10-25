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
import { ProviderLogo } from "./ProviderLogo";
import { QuickBalanceForm } from "./QuickBalanceForm";
import { QuickQuotaForm } from "./QuickQuotaForm";
import { EmptyState, ProgressBar } from "./ui";

export function DashboardView({ accounts }: { accounts: AccountView[] }) {
  return (
    <>
      <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-2xl">
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
        <>
          <div className="mt-3 space-y-1.5 sm:hidden">
            {accounts.map((account) => (
              <CompactProviderRow key={account.id} account={account} />
            ))}
          </div>
          <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-2">
            {accounts.map((account) => (
              <ProviderSummary key={account.id} account={account} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function CompactProviderRow({ account }: { account: AccountView }) {
  const windows = summaryWindows(account.quota);
  const credit = primaryCredit(account.credits);
  const positiveQuotaUsd = windows.some(
    ({ quota }) => quota.unit === "usd" && quota.remaining !== null && quota.remaining > 0,
  );
  const displayCredit = credit && credit.amount === 0 && positiveQuotaUsd ? null : credit;
  const attention = attentionFor(account);

  return (
    <Link
      href={`/providers/${account.id}`}
      className="block rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 transition hover:bg-slate-50/70"
    >
      <div className="flex items-center gap-2.5">
        <ProviderLogo
          provider={account.provider}
          label={account.displayName}
          className="h-7 w-7"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {account.displayName}
          </h2>
          <AttentionDot attention={attention} />
        </div>

        {displayCredit ? (
          <div className="shrink-0 text-right">
            <div className="text-[10px] leading-tight text-slate-400">Credits left</div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">
              {formatMoney(displayCredit.amount, displayCredit.currency)}
            </div>
          </div>
        ) : windows.length === 0 ? (
          <span className="shrink-0 text-[11px] text-slate-400">
            {account.planName ?? "No data"}
          </span>
        ) : null}
      </div>

      {windows.length > 0 ? (
        <div className="mt-2 space-y-1">
          {windows.map(({ key, label, quota }) => (
            <MiniQuotaRow
              key={`${key}-${quota.modelScope ?? ""}`}
              accountName={account.displayName}
              label={label}
              quota={quota}
            />
          ))}
        </div>
      ) : null}
    </Link>
  );
}

function MiniQuotaRow({
  accountName,
  label,
  quota,
}: {
  accountName: string;
  label: string;
  quota: QuotaView;
}) {
  const usedPercent = usagePercentFromQuota(quota);
  const colors = USAGE_BAND_COLORS[usageBand(usedPercent)];

  return (
    <div className="flex items-center gap-2">
      <span
        title={label}
        className="w-14 shrink-0 truncate text-[10px] font-medium text-slate-500"
      >
        {label}
      </span>
      <div className="flex-1">
        <ProgressBar
          usedPercent={usedPercent}
          label={`${accountName} ${label} quota used`}
          className="h-1.5"
        />
      </div>
      <span
        className={`w-8 shrink-0 text-right text-[10px] font-semibold tabular-nums ${colors.text}`}
      >
        {usedPercent === null ? "—" : `${Math.round(usedPercent)}%`}
      </span>
    </div>
  );
}

function ProviderSummary({ account }: { account: AccountView }) {
  const windows = summaryWindows(account.quota);
  const credit = primaryCredit(account.credits);
  const positiveQuotaUsd = windows.some(
    ({ quota }) => quota.unit === "usd" && quota.remaining !== null && quota.remaining > 0,
  );
  const displayCredit = credit && credit.amount === 0 && positiveQuotaUsd ? null : credit;
  const manual =
    account.provider === "TOKENHARBOR" ||
    account.provider === "RIVER_AI" ||
    (account.provider === "QODER" && account.authMode === "MANUAL");
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
      <article className="card min-w-0 overflow-hidden p-4">
        <Link
          href={`/providers/${account.id}`}
          className="flex items-center justify-between gap-2"
        >
          <h2 className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-semibold text-slate-900">
            <ProviderLogo
              provider={account.provider}
              label={account.displayName}
              className="h-7 w-7"
            />
            <span className="truncate">{account.displayName}</span>
          </h2>
          <span className="flex shrink-0 items-center gap-1.5">
            <Icon
              name="chevron-right"
              className="h-3.5 w-3.5 shrink-0 text-slate-400"
            />
            <AttentionDot attention={attention} />
          </span>
        </Link>

        <p className="mt-1 text-xs leading-relaxed text-slate-500">{manualNote(account)}</p>

        {account.authMode === "LIVE" && account.provider === "QODER" ? (
          <Link
            href={`/providers/${account.id}`}
            className="mt-3 block text-center text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
          >
            View connection
          </Link>
        ) : (
          <>
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
          </>
        )}
      </article>
    );
  }

  return (
    <article className="card min-w-0 overflow-hidden">
      <Link
        href={`/providers/${account.id}`}
        className="block p-4 transition hover:bg-slate-50/60"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-semibold text-slate-900">
            <ProviderLogo
              provider={account.provider}
              label={account.displayName}
              className="h-7 w-7"
            />
            <span className="truncate">{account.displayName}</span>
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
    if (account.provider === "QODER" && account.authMode === "LIVE") {
      return "Connection needs attention · check the Qoder CLI login";
    }
    if (account.provider === "YETA" && account.authMode === "LIVE") {
      return "Connection needs attention · check the Yeta API key";
    }
    return "Connection needs attention · add data manually";
  }
  if (account.provider === "TOKENHARBOR") {
    return "Office Pass · usage and balance are manual";
  }
  if (account.provider === "RIVER_AI") {
    return "Credit · add your current balance";
  }
  if (account.provider === "QODER") {
    if (account.authMode === "MANUAL") {
      return "Plan credits · usage and add-on balance are manual";
    }
    return account.planName?.toLowerCase() === "free"
      ? "Free plan · no plan credits"
      : "Live · no quota reported yet";
  }
  if (account.provider === "YETA") {
    return account.authMode === "MANUAL"
      ? "Credit · add your current balance"
      : "Live · balance not synced yet";
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
