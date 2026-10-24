import type { QuotaUnitKey, QuotaWindowKey } from "./schemas";

export const WINDOW_LABELS: Record<QuotaWindowKey, string> = {
  rolling_5h: "5-hour window",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  other: "Other",
};

export const WINDOW_SHORT: Record<QuotaWindowKey, string> = {
  rolling_5h: "5-hour",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  other: "Other",
};

export const UNIT_LABELS: Record<QuotaUnitKey, string> = {
  tokens: "tokens",
  requests: "requests",
  credits: "credits",
  usd: "USD",
  percent: "%",
  provider_defined: "units",
};

export function windowLabel(window: QuotaWindowKey): string {
  return WINDOW_LABELS[window] ?? window;
}

export function unitLabel(unit: QuotaUnitKey): string {
  return UNIT_LABELS[unit] ?? unit;
}

export function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

export function formatMetric(value: number | null, unit: QuotaUnitKey): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  if (unit === "percent") return `${formatNumber(value, 1)}%`;
  if (unit === "usd") return formatMoney(value, "USD");
  if (unit === "credits") return `${formatNumber(value, 2)} credits`;
  if (unit === "tokens") return `${formatNumber(value, 0)} tokens`;
  if (unit === "requests") return `${formatNumber(value, 0)} requests`;
  return `${formatNumber(value, 2)} ${unitLabel(unit)}`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: Math.abs(amount) < 1 ? 4 : 2,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, 2)} ${currency}`;
  }
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 1)}%`;
}

export function formatDateTime(value: string | Date | null, timezone = "UTC"): string {
  if (!value) return "Not available";
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "Not available";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatRelative(
  value: string | Date | null,
  now: Date = new Date(),
): string {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "Never";

  const deltaMs = date.getTime() - now.getTime();
  const past = deltaMs <= 0;
  const seconds = Math.round(Math.abs(deltaMs) / 1000);

  if (seconds < 45) return past ? "just now" : "in a moment";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return past ? `${minutes} min ago` : `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return past ? `${hours} hr ago` : `in ${hours} hr`;
  const days = Math.round(hours / 24);
  if (days < 30) return past ? `${days} day${days === 1 ? "" : "s"} ago` : `in ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30);
  return past ? `${months} mo ago` : `in ${months} mo`;
}

/** Compact countdown used on cards: "2d 4h", "3h 12m", "4m 09s". */
export function formatCountdown(target: string | Date | null, now: Date = new Date()): string {
  if (!target) return "Reset time unavailable";
  const date = typeof target === "string" ? new Date(target) : target;
  if (!Number.isFinite(date.getTime())) return "Reset time unavailable";

  let remaining = date.getTime() - now.getTime();
  if (remaining <= 0) return "Reset due";

  const days = Math.floor(remaining / 86_400_000);
  remaining -= days * 86_400_000;
  const hours = Math.floor(remaining / 3_600_000);
  remaining -= hours * 3_600_000;
  const minutes = Math.floor(remaining / 60_000);
  remaining -= minutes * 60_000;
  const seconds = Math.floor(remaining / 1000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export type FreshnessKind = "live" | "stale" | "never" | "manual" | "error";

export interface Freshness {
  kind: FreshnessKind;
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

export function computeFreshness(input: {
  lastLiveSyncAt: string | Date | null;
  latestObservationAt: string | Date | null;
  latestSource: "live" | "manual" | "cached" | "estimated" | null;
  refreshIntervalMin: number;
  hasError: boolean;
  now?: Date;
}): Freshness {
  const now = input.now ?? new Date();

  if (input.hasError) {
    return { kind: "error", label: "Needs attention", tone: "bad" };
  }

  if (input.latestSource === "manual") {
    return {
      kind: "manual",
      label: input.latestObservationAt
        ? `Manual · updated ${formatRelative(input.latestObservationAt, now)}`
        : "Manual data",
      tone: "neutral",
    };
  }

  if (input.latestSource === "estimated") {
    return {
      kind: "stale",
      label: input.latestObservationAt
        ? `Estimated · updated ${formatRelative(input.latestObservationAt, now)}`
        : "Estimated",
      tone: "warn",
    };
  }

  if (!input.lastLiveSyncAt) {
    return { kind: "never", label: "Not synced yet", tone: "neutral" };
  }

  // A successful connection check with no observations is not "live data".
  if (!input.latestObservationAt) {
    return { kind: "live", label: "Connected · no metrics yet", tone: "neutral" };
  }

  const ageMs = now.getTime() - new Date(input.lastLiveSyncAt).getTime();
  const staleAfterMs = Math.max(input.refreshIntervalMin * 2, 15) * 60_000;

  if (ageMs <= staleAfterMs) {
    return {
      kind: "live",
      label: `Live · ${formatRelative(input.lastLiveSyncAt, now)}`,
      tone: "good",
    };
  }

  return {
    kind: "stale",
    label: `Stale · last synced ${formatRelative(input.lastLiveSyncAt, now)}`,
    tone: "warn",
  };
}

export type UsageBand = "safe" | "watch" | "elevated" | "critical" | "full" | "unknown";

/**
 * Consumption percentage for the progress bar. Remaining is the canonical
 * stored value; usage is derived from it (or from used/limit) rather than
 * guessed. Returns null when no percentage can be established.
 */
export function usagePercentFromQuota(input: {
  remainingPercent: number | null;
  used: number | null;
  limit: number | null;
}): number | null {
  if (input.remainingPercent !== null && Number.isFinite(input.remainingPercent)) {
    return Math.min(100, Math.max(0, 100 - input.remainingPercent));
  }
  if (
    input.used !== null &&
    input.limit !== null &&
    input.limit > 0 &&
    Number.isFinite(input.used) &&
    Number.isFinite(input.limit)
  ) {
    return Math.min(100, Math.max(0, (input.used / input.limit) * 100));
  }
  return null;
}

export function usageBand(percent: number | null): UsageBand {
  if (percent === null || !Number.isFinite(percent)) return "unknown";
  if (percent >= 99.5) return "full";
  if (percent >= 80) return "critical";
  if (percent >= 65) return "elevated";
  if (percent >= 50) return "watch";
  return "safe";
}

export const USAGE_BAND_COLORS: Record<
  UsageBand,
  { bar: string; text: string; label: string }
> = {
  safe: { bar: "bg-emerald-500", text: "text-emerald-700", label: "Comfortable" },
  watch: { bar: "bg-amber-400", text: "text-amber-700", label: "Half used" },
  elevated: { bar: "bg-orange-500", text: "text-orange-700", label: "High usage" },
  critical: { bar: "bg-rose-500", text: "text-rose-700", label: "Near limit" },
  full: { bar: "bg-slate-950", text: "text-slate-950", label: "Limit reached" },
  unknown: { bar: "bg-slate-300", text: "text-slate-500", label: "Usage unavailable" },
};

export type RemainingBand = "critical" | "low" | "medium" | "healthy" | "unknown";

export function remainingBand(percent: number | null): RemainingBand {
  if (percent === null || !Number.isFinite(percent)) return "unknown";
  if (percent <= 10) return "critical";
  if (percent <= 25) return "low";
  if (percent <= 50) return "medium";
  return "healthy";
}

export const BAND_COLORS: Record<
  RemainingBand,
  { bar: string; text: string; badge: string; label: string }
> = {
  critical: {
    bar: "bg-rose-500",
    text: "text-rose-700",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    label: "Critical",
  },
  low: {
    bar: "bg-amber-500",
    text: "text-amber-700",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    label: "Low",
  },
  medium: {
    bar: "bg-sky-500",
    text: "text-sky-700",
    badge: "bg-sky-50 text-sky-700 ring-sky-200",
    label: "Watch",
  },
  healthy: {
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    label: "Healthy",
  },
  unknown: {
    bar: "bg-slate-300",
    text: "text-slate-600",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
    label: "Unknown",
  },
};

export const WINDOW_PRIORITY: Record<QuotaWindowKey, number> = {
  rolling_5h: 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
  other: 4,
};

export function lowestRemainingPercent(
  snapshots: Array<{ remainingPercent: number | null; window: QuotaWindowKey; modelScope: string | null }>,
): { percent: number; window: QuotaWindowKey; modelScope: string | null } | null {
  const candidates = snapshots
    .filter(
      (snapshot): snapshot is typeof snapshot & { remainingPercent: number } =>
        snapshot.remainingPercent !== null && Number.isFinite(snapshot.remainingPercent),
    )
    .sort((a, b) => {
      if (a.remainingPercent !== b.remainingPercent) {
        return a.remainingPercent - b.remainingPercent;
      }
      return WINDOW_PRIORITY[a.window] - WINDOW_PRIORITY[b.window];
    });

  const best = candidates[0];
  return best
    ? { percent: best.remainingPercent, window: best.window, modelScope: best.modelScope }
    : null;
}

export function isExpired(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time <= now.getTime();
}

export function ageMinutes(value: string | Date | null, now = new Date()): number | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / 60_000);
}
