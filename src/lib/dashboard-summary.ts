import type { CreditView, QuotaView } from "./dashboard";
import { WINDOW_LABELS } from "./quota";
import type { QuotaWindowKey } from "./schemas";

const SUMMARY_WINDOWS: Array<{ window: QuotaWindowKey; label: string }> = [
  { window: "rolling_5h", label: "5-hour" },
  { window: "weekly", label: "Weekly" },
  { window: "monthly", label: "Monthly" },
];

export interface SummaryWindow {
  key: QuotaWindowKey;
  label: string;
  quota: QuotaView;
}

const MAX_SUMMARY_WINDOWS = 3;

function scopeRank(scope: string | null): number {
  if (!scope) return 0;
  if (/paid/i.test(scope)) return 1;
  if (/free/i.test(scope)) return 2;
  return 3;
}

function byScope(a: QuotaView, b: QuotaView): number {
  const rank = scopeRank(a.modelScope) - scopeRank(b.modelScope);
  if (rank !== 0) return rank;
  return (a.modelScope ?? "").localeCompare(b.modelScope ?? "");
}

function labelFor(base: string, rows: QuotaView[], row: QuotaView): string {
  if (row.modelScope) return row.modelScope;
  if (rows.length === 1) return base;
  return `${base} ${rows.indexOf(row) + 1}`;
}

/**
 * The dashboard shows up to three headline windows. If none exist, fall back
 * to whatever windows were recorded (for example a manual daily snapshot) so
 * the provider is not left blank.
 *
 * Providers can expose more than one window of the same type (TokenHarbor's
 * Office Pass has separate paid-model and free-model weekly allowances). One
 * row per canonical window is chosen first, then extra scoped rows fill any
 * remaining slots, so a second weekly meter never displaces 5-hour or monthly.
 */
export function summaryWindows(quota: QuotaView[]): SummaryWindow[] {
  const grouped = new Map<QuotaWindowKey, QuotaView[]>();
  for (const row of quota) {
    const rows = grouped.get(row.window) ?? [];
    rows.push(row);
    grouped.set(row.window, rows);
  }
  for (const rows of grouped.values()) rows.sort(byScope);

  const summary: SummaryWindow[] = [];
  const seen = new Set<QuotaWindowKey>();

  const add = (window: QuotaWindowKey, base: string, row: QuotaView, rows: QuotaView[]) => {
    if (summary.length >= MAX_SUMMARY_WINDOWS) return;
    summary.push({ key: window, label: labelFor(base, rows, row), quota: row });
  };

  for (const candidate of SUMMARY_WINDOWS) {
    const rows = grouped.get(candidate.window);
    const first = rows?.[0];
    if (!rows || !first) continue;
    seen.add(candidate.window);
    add(candidate.window, candidate.label, first, rows);
  }

  for (const candidate of SUMMARY_WINDOWS) {
    const rows = grouped.get(candidate.window);
    if (!rows?.length) continue;
    for (const row of rows.slice(1)) add(candidate.window, candidate.label, row, rows);
  }

  if (summary.length > 0) return summary;

  for (const row of quota) {
    if (seen.has(row.window)) continue;
    seen.add(row.window);
    const rows = grouped.get(row.window) ?? [row];
    const first = rows[0];
    if (!first) continue;
    add(row.window, WINDOW_LABELS[row.window] ?? row.window, first, rows);
  }

  for (const row of quota) {
    const rows = grouped.get(row.window);
    if (!rows || row !== rows[0]) continue;
    const base = WINDOW_LABELS[row.window] ?? row.window;
    for (const scoped of rows.slice(1)) add(row.window, base, scoped, rows);
  }

  return summary;
}

const CREDIT_PRIORITY = ["WALLET", "INCLUDED_ALLOWANCE", "PROMOTIONAL", "REWARD", "OTHER"];

/**
 * One balance is enough for the compact dashboard. Prefer a USD wallet, then
 * the other USD credit types, and only fall back to another currency when no
 * USD balance exists.
 */
export function primaryCredit(credits: CreditView[]): CreditView | null {
  if (credits.length === 0) return null;

  const usd = credits.filter((credit) => credit.currency.toUpperCase() === "USD");
  const pool = usd.length > 0 ? usd : credits;

  for (const type of CREDIT_PRIORITY) {
    const match = pool.find((credit) => credit.creditType === type);
    if (match) return match;
  }

  return pool[0] ?? null;
}
