"use client";

import { useId, useState } from "react";
import { Icon } from "./icons";

const ROWS = [
  { scope: "Paid models", label: "Paid models" },
  { scope: "Free models", label: "Free models" },
] as const;

type QuotaScope = (typeof ROWS)[number]["scope"];

/**
 * TokenHarbor's Office Pass has no usage API, but the console shows weekly
 * paid-model and free-model allowances. Two percentage fields let the user
 * record both windows at once from the dashboard.
 */
export function QuickQuotaForm({
  accountId,
  variant = "block",
  triggerLabel,
  initialValues,
}: {
  accountId: string;
  variant?: "block" | "inline";
  triggerLabel?: string;
  initialValues?: Partial<Record<QuotaScope, number | null>>;
}) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const row of ROWS) {
      const value = initialValues?.[row.scope];
      if (value != null && Number.isFinite(value)) {
        initial[row.scope] = String(Math.round(value * 10) / 10);
      }
    }
    return initial;
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setValue(scope: string, value: string) {
    setValues((current) => ({ ...current, [scope]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const entries = ROWS.map((row) => ({
      ...row,
      raw: values[row.scope]?.trim() ?? "",
    })).filter((row) => row.raw !== "");

    if (entries.length === 0) {
      setError("Enter at least one percentage.");
      return;
    }

    const parsed = entries.map((row) => ({ ...row, used: Number(row.raw) }));
    if (parsed.some((row) => !Number.isFinite(row.used) || row.used < 0 || row.used > 100)) {
      setError("Percentages must be between 0 and 100.");
      return;
    }

    setPending(true);

    try {
      for (const row of parsed) {
        const response = await fetch(`/api/providers/${accountId}/quota`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            windowType: "weekly",
            unit: "percent",
            remainingPercent: 100 - row.used,
            modelScope: row.scope,
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string; details?: Array<{ message: string }> } }
          | null;

        if (!response.ok) {
          throw new Error(
            body?.error?.details?.[0]?.message ??
              body?.error?.message ??
              "Could not save weekly usage",
          );
        }
      }

      setValues({});
      setOpen(false);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save weekly usage");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    if (variant === "inline") {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 py-1 text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
        >
          <Icon name="refresh" className="h-3 w-3" />
          {triggerLabel ?? "Update usage"}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary mt-2 w-full"
      >
        <Icon name="plus" className="h-4 w-4" />
        {triggerLabel ?? "Add weekly usage"}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 w-full rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        Enter the used percentage shown for each Office Pass window.
      </p>

      <div className="mt-3 space-y-2">
        {ROWS.map((row) => {
          const id = `${formId}-${row.scope}`;
          return (
            <div key={row.scope} className="flex items-center gap-2">
              <label
                htmlFor={id}
                className="w-[5.5rem] shrink-0 text-[11px] font-medium text-slate-600"
              >
                {row.label}
              </label>
              <input
                id={id}
                className="input h-8 min-w-0 flex-1 py-1 text-xs"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                placeholder="Used %"
                value={values[row.scope] ?? ""}
                onChange={(event) => setValue(row.scope, event.target.value)}
              />
              <span className="text-[11px] text-slate-400">%</span>
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary flex-1 text-xs">
          {pending ? "Saving…" : "Save usage"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="btn-secondary flex-1 text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
