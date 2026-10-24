import type { AccountView, CreditView, QuotaView } from "@/lib/dashboard";
import {
  BAND_COLORS,
  formatDateTime,
  formatMetric,
  formatMoney,
  formatPercent,
  remainingBand,
  windowLabel,
} from "@/lib/quota";
import { Countdown } from "@/components/Countdown";

const STATUS_MAP: Record<string, { label: string; classes: string; dot: string }> = {
  CONNECTED: { label: "Connected", classes: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  MANUAL: { label: "Manual", classes: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
  NEEDS_ATTENTION: { label: "Needs attention", classes: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  ERROR: { label: "Error", classes: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  NEVER_CONNECTED: { label: "Not synced", classes: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
  DISCONNECTED: { label: "Disconnected", classes: "bg-slate-100 text-slate-500 ring-slate-200", dot: "bg-slate-400" },
};

export function StatusPill({ status }: { status: string }) {
  const config = STATUS_MAP[status] ?? {
    label: status,
    classes: "bg-slate-100 text-slate-600 ring-slate-200",
    dot: "bg-slate-400",
  };

  return (
    <span className={`badge ${config.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

const FRESHNESS_CLASSES: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  neutral: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function FreshnessPill({ account }: { account: AccountView }) {
  return (
    <span className={`badge ${FRESHNESS_CLASSES[account.freshness.tone] ?? FRESHNESS_CLASSES.neutral}`}>
      {account.freshness.label}
    </span>
  );
}

export function ProgressBar({
  percent,
  className = "",
}: {
  percent: number | null;
  className?: string;
}) {
  const band = remainingBand(percent);
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${BAND_COLORS[band].bar}`}
        style={{ width: `${percent === null ? 0 : Math.min(100, Math.max(0, percent))}%` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label="Quota remaining"
      />
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  live: "Live",
  manual: "Manual",
  cached: "Cached",
  estimated: "Estimated",
};

export function SourceBadge({ source }: { source: string }) {
  const classes =
    source === "live"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : source === "manual"
        ? "bg-slate-100 text-slate-600 ring-slate-200"
        : source === "estimated"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-sky-50 text-sky-700 ring-sky-200";
  return <span className={`badge ${classes}`}>{SOURCE_LABELS[source] ?? source}</span>;
}

export const CREDIT_LABELS: Record<string, string> = {
  WALLET: "Wallet balance",
  PROMOTIONAL: "Promotional credit",
  REWARD: "Reward credit",
  INCLUDED_ALLOWANCE: "Included allowance",
  OTHER: "Other credit",
};

export function CreditLine({ credit }: { credit: CreditView }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500">{CREDIT_LABELS[credit.creditType] ?? credit.creditType}</span>
      <span className="font-semibold tabular-nums text-slate-900">
        {formatMoney(credit.amount, credit.currency)}
      </span>
    </div>
  );
}

export function QuotaLine({
  quota,
  timezone,
}: {
  quota: QuotaView;
  timezone: string;
}) {
  const band = remainingBand(quota.remainingPercent);
  const colors = BAND_COLORS[band];
  const resetLabel = quota.resetsAt
    ? formatDateTime(quota.resetsAt, timezone)
    : "Reset time unavailable";

  const remainingText =
    quota.unit === "percent"
      ? formatPercent(quota.remainingPercent)
      : quota.remaining !== null
        ? `${formatMetric(quota.remaining, quota.unit)} left`
        : "Remaining unavailable";

  const limitText =
    quota.limit !== null && quota.unit !== "percent"
      ? ` of ${formatMetric(quota.limit, quota.unit)}`
      : "";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-800">
            {windowLabel(quota.window)}
          </span>
          {quota.modelScope ? (
            <span className="badge bg-slate-50 text-slate-500 ring-slate-200">
              {quota.modelScope}
            </span>
          ) : null}
        </div>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${colors.text}`}>
          {formatPercent(quota.remainingPercent)}
        </span>
      </div>

      <ProgressBar percent={quota.remainingPercent} />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        <span>
          {remainingText}
          {limitText}
        </span>
        <span className="inline-flex items-center gap-1">
          <Countdown target={quota.resetsAt} />
        </span>
      </div>

      <p className="text-[11px] text-slate-400">
        {quota.resetsAt ? `Resets ${resetLabel}` : resetLabel}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="mt-4 text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
