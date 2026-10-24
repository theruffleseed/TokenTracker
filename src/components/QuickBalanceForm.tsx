"use client";

import { useId, useState } from "react";
import { Icon } from "./icons";

const CREDIT_TYPES = [
  ["WALLET", "Wallet balance"],
  ["INCLUDED_ALLOWANCE", "Included allowance"],
  ["PROMOTIONAL", "Promotional credit"],
  ["REWARD", "Reward credit"],
  ["OTHER", "Other"],
] as const;

type CreditType = (typeof CREDIT_TYPES)[number][0];

export function QuickBalanceForm({
  accountId,
  variant = "block",
  triggerLabel,
  initialAmount,
  initialType,
}: {
  accountId: string;
  variant?: "block" | "inline";
  triggerLabel?: string;
  initialAmount?: number;
  initialType?: string;
}) {
  const amountId = useId();
  const typeId = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(initialAmount == null ? "" : String(initialAmount));
  const [creditType, setCreditType] = useState<CreditType>(() =>
    CREDIT_TYPES.some(([value]) => value === initialType)
      ? (initialType as CreditType)
      : "WALLET",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/providers/${accountId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), currency: "USD", creditType }),
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

      setAmount("");
      setOpen(false);
      window.location.reload();
    } catch {
      setError("Could not reach the server");
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
          {triggerLabel ?? "Update balance"}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary mt-3 w-full py-2 text-xs"
      >
        {triggerLabel ?? "Add balance"}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 w-full space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3"
    >
      <div>
        <label
          htmlFor={amountId}
          className="mb-1 block text-[11px] font-semibold text-slate-500"
        >
          Balance (USD)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            $
          </span>
          <input
            id={amountId}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            required
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="input pl-7"
            placeholder="0.00"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={typeId}
          className="mb-1 block text-[11px] font-semibold text-slate-500"
        >
          Credit type
        </label>
        <select
          id={typeId}
          className="input"
          value={creditType}
          onChange={(event) => setCreditType(event.target.value as CreditType)}
        >
          {CREDIT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || amount.trim() === ""}
          className="btn-primary flex-1 py-1.5 text-xs"
        >
          {pending ? "Saving…" : "Save balance"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="btn-ghost py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
