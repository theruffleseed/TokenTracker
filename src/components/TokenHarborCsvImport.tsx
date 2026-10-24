"use client";

import { useId, useState } from "react";
import { formatMoney } from "@/lib/quota";
import {
  parseTokenHarborCsv,
  type TokenHarborCsvPreview,
} from "@/lib/tokenharbor-csv";
import { Icon } from "./icons";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function formatObserved(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function rowSummary(preview: TokenHarborCsvPreview): string {
  const parts = [`${preview.rowCount} transaction${preview.rowCount === 1 ? "" : "s"} read`];
  if (preview.skippedRows > 0) parts.push(`${preview.skippedRows} skipped`);
  return parts.join(" · ");
}

/**
 * Reads the official Transaction Ledger CSV in the browser and saves the
 * latest running balance as a manual WALLET snapshot. The file never leaves
 * the device; only the resulting amount is posted.
 */
export function TokenHarborCsvImport({ accountId }: { accountId: string }) {
  const inputId = useId();
  const [preview, setPreview] = useState<TokenHarborCsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setPreview(null);

    if (file.size > MAX_FILE_BYTES) {
      setError("CSV files up to 5 MB are supported.");
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("Could not read that file.");
      return;
    }

    const result = parseTokenHarborCsv(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setPreview(result.preview);
  }

  async function save() {
    if (!preview) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/providers/${accountId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: preview.amount,
          currency: "USD",
          creditType: "WALLET",
          observedAt: preview.observedAt,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string; details?: Array<{ message: string }> } }
        | null;

      if (!response.ok) {
        setError(
          body?.error?.details?.[0]?.message ??
            body?.error?.message ??
            "Could not save this balance",
        );
        return;
      }

      window.location.reload();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Import billing CSV</h3>
        <span className="badge bg-slate-100 text-slate-600 ring-slate-200">Wallet only</span>
      </div>

      {preview ? (
        <>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Latest ledger balance
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatMoney(preview.amount, preview.currency)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {formatObserved(preview.observedAt)}
              {preview.type ? ` · ${preview.type}` : ""}
              {preview.pool ? ` · ${preview.pool}` : ""}
              {preview.status ? ` · ${preview.status}` : ""}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">{rowSummary(preview)}</p>
          </div>

          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            This ledger updates the wallet balance only. Office Pass weekly usage is not included,
            so keep recording those percentages separately.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="btn-primary flex-1 py-2 text-xs"
            >
              {pending ? "Saving…" : "Save wallet balance"}
            </button>
            <label
              htmlFor={inputId}
              className="btn-secondary cursor-pointer px-3 py-2 text-xs"
            >
              Choose another
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Download your ledger from TokenHarbor Dashboard → Billing, then choose it here. The
            latest running balance becomes the wallet balance. The file stays in your browser.
          </p>
          <label
            htmlFor={inputId}
            className="btn-secondary mt-3 inline-flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs"
          >
            <Icon name="database" className="h-3.5 w-3.5" />
            Choose CSV file
          </label>
        </>
      )}

      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="TokenHarbor billing CSV"
        onChange={onFile}
      />

      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
