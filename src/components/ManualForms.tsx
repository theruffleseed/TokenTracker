"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const WINDOWS = [
  ["rolling_5h", "5-hour rolling"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["other", "Other"],
] as const;

const UNITS = [
  ["percent", "Percent"],
  ["usd", "USD"],
  ["credits", "Credits"],
  ["tokens", "Tokens"],
  ["requests", "Requests"],
  ["provider_defined", "Provider-defined"],
] as const;

const CREDIT_TYPES = [
  ["WALLET", "Wallet balance"],
  ["PROMOTIONAL", "Promotional credit"],
  ["REWARD", "Reward credit"],
  ["INCLUDED_ALLOWANCE", "Included allowance"],
  ["OTHER", "Other"],
] as const;

export function ManualForms({ accountId }: { accountId: string }) {
  return (
    <div id="manual" className="grid items-start gap-4 lg:grid-cols-2">
      <QuotaForm accountId={accountId} />
      <CreditForm accountId={accountId} />
    </div>
  );
}

function QuotaForm({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [windowType, setWindowType] = useState("monthly");
  const [unit, setUnit] = useState("usd");
  const [limitValue, setLimitValue] = useState("");
  const [usedValue, setUsedValue] = useState("");
  const [remainingValue, setRemainingValue] = useState("");
  const [remainingPercent, setRemainingPercent] = useState("");
  const [resetsAt, setResetsAt] = useState("");
  const [modelScope, setModelScope] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const number = (value: string) => (value.trim() === "" ? null : Number(value));

    try {
      const response = await fetch(`/api/providers/${accountId}/quota`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          windowType,
          unit,
          limitValue: number(limitValue),
          usedValue: number(usedValue),
          remainingValue: number(remainingValue),
          remainingPercent: number(remainingPercent),
          resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
          modelScope: modelScope.trim() || null,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string; details?: Array<{ message: string }> } }
        | null;

      if (!response.ok) {
        setError(
          body?.error?.details?.[0]?.message ??
            body?.error?.message ??
            "Could not save this snapshot",
        );
        return;
      }

      setMessage("Manual quota snapshot saved");
      setLimitValue("");
      setUsedValue("");
      setRemainingValue("");
      setRemainingPercent("");
      setResetsAt("");
      setModelScope("");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Add manual quota</h2>
        <span className="badge bg-slate-100 text-slate-600 ring-slate-200">Manual</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Use this for any provider window. Leave unknown fields blank; remaining values are only
        calculated when the inputs support it.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="q-window" className="label mb-1.5">
            Window
          </label>
          <select id="q-window" className="input" value={windowType} onChange={(event) => setWindowType(event.target.value)}>
            {WINDOWS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="q-unit" className="label mb-1.5">
            Unit
          </label>
          <select id="q-unit" className="input" value={unit} onChange={(event) => setUnit(event.target.value)}>
            {UNITS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="q-limit" className="label mb-1.5">
            Limit
          </label>
          <input id="q-limit" className="input" inputMode="decimal" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} />
        </div>
        <div>
          <label htmlFor="q-used" className="label mb-1.5">
            Used
          </label>
          <input id="q-used" className="input" inputMode="decimal" value={usedValue} onChange={(event) => setUsedValue(event.target.value)} />
        </div>
        <div>
          <label htmlFor="q-remaining" className="label mb-1.5">
            Remaining
          </label>
          <input id="q-remaining" className="input" inputMode="decimal" value={remainingValue} onChange={(event) => setRemainingValue(event.target.value)} />
        </div>
        <div>
          <label htmlFor="q-percent" className="label mb-1.5">
            Remaining %
          </label>
          <input
            id="q-percent"
            className="input"
            inputMode="decimal"
            min={0}
            max={100}
            value={remainingPercent}
            onChange={(event) => setRemainingPercent(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="q-reset" className="label mb-1.5">
            Resets at (optional)
          </label>
          <input id="q-reset" type="datetime-local" className="input" value={resetsAt} onChange={(event) => setResetsAt(event.target.value)} />
        </div>
        <div>
          <label htmlFor="q-scope" className="label mb-1.5">
            Model scope (optional)
          </label>
          <input id="q-scope" className="input" maxLength={160} value={modelScope} onChange={(event) => setModelScope(event.target.value)} placeholder="e.g. claude-haiku" />
        </div>
      </div>

      {unit === "percent" ? (
        <p className="mt-2 text-[11px] text-slate-400">Percent quotas require the remaining percentage.</p>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-xs text-emerald-600">{message}</p> : null}

      <button type="submit" disabled={pending} className="btn-primary mt-4 w-full">
        {pending ? "Saving…" : "Save quota snapshot"}
      </button>
    </form>
  );
}

function CreditForm({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [creditType, setCreditType] = useState("WALLET");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/providers/${accountId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          currency,
          creditType,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string; details?: Array<{ message: string }> } }
        | null;

      if (!response.ok) {
        setError(body?.error?.details?.[0]?.message ?? body?.error?.message ?? "Could not save this balance");
        return;
      }

      setMessage("Manual balance snapshot saved");
      setAmount("");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Add manual balance</h2>
        <span className="badge bg-slate-100 text-slate-600 ring-slate-200">Manual</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Monetary credits only. Wallet balance, promotional credit, and included allowance are kept
        separate and never combined into a token or percent total.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="c-amount" className="label mb-1.5">
            Amount
          </label>
          <input
            id="c-amount"
            className="input"
            inputMode="decimal"
            required
            min={0}
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="c-currency" className="label mb-1.5">
            Currency
          </label>
          <input
            id="c-currency"
            className="input uppercase"
            required
            maxLength={3}
            minLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="c-type" className="label mb-1.5">
            Credit type
          </label>
          <select id="c-type" className="input" value={creditType} onChange={(event) => setCreditType(event.target.value)}>
            {CREDIT_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-xs text-emerald-600">{message}</p> : null}

      <button type="submit" disabled={pending} className="btn-primary mt-4 w-full">
        {pending ? "Saving…" : "Save balance snapshot"}
      </button>
    </form>
  );
}
