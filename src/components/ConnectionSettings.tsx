"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

export function ConnectionSettings({
  accountId,
  displayName,
  planName,
  accountLabel,
  refreshIntervalMin,
  authMode,
  credentialHint,
}: {
  accountId: string;
  displayName: string;
  planName: string | null;
  accountLabel: string | null;
  refreshIntervalMin: number;
  authMode: "LIVE" | "MANUAL";
  credentialHint: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName,
    planName: planName ?? "",
    accountLabel: accountLabel ?? "",
    refreshIntervalMin: String(refreshIntervalMin),
  });
  const [credential, setCredential] = useState("");
  const [pending, setPending] = useState<"details" | "credential" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("details");
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/providers/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName,
          planName: form.planName.trim() || null,
          accountLabel: form.accountLabel.trim() || null,
          refreshIntervalMin: Number(form.refreshIntervalMin),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not save connection settings");
        return;
      }
      setMessage("Connection settings saved");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(null);
    }
  }

  async function saveCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credential.trim()) return;
    setPending("credential");
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/providers/${accountId}/credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credential.trim() }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not replace the credential");
        return;
      }
      setCredential("");
      setMessage("Credential replaced. Run a refresh to verify it.");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Connection settings</h2>
        <span className="badge bg-slate-100 text-slate-600 ring-slate-200">
          {authMode === "LIVE" ? "Live" : "Manual"}
        </span>
      </div>

      <form onSubmit={saveDetails} className="mt-4 space-y-3">
        <div>
          <label htmlFor="s-name" className="label mb-1.5">
            Display name
          </label>
          <input
            id="s-name"
            className="input"
            required
            maxLength={80}
            value={form.displayName}
            onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="s-plan" className="label mb-1.5">
              Plan
            </label>
            <input
              id="s-plan"
              className="input"
              maxLength={80}
              value={form.planName}
              onChange={(event) => setForm((current) => ({ ...current, planName: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="s-interval" className="label mb-1.5">
              Refresh
            </label>
            <select
              id="s-interval"
              className="input"
              value={form.refreshIntervalMin}
              onChange={(event) => setForm((current) => ({ ...current, refreshIntervalMin: event.target.value }))}
            >
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">1 hour</option>
              <option value="180">3 hours</option>
              <option value="720">12 hours</option>
              <option value="1440">24 hours</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="s-label" className="label mb-1.5">
            Account label
          </label>
          <input
            id="s-label"
            className="input"
            maxLength={160}
            value={form.accountLabel}
            onChange={(event) => setForm((current) => ({ ...current, accountLabel: event.target.value }))}
          />
        </div>
        <button type="submit" disabled={pending !== null} className="btn-secondary w-full">
          {pending === "details" ? "Saving…" : "Save details"}
        </button>
      </form>

      {authMode === "LIVE" ? (
        <form onSubmit={saveCredential} className="mt-5 border-t border-slate-100 pt-4">
          <label htmlFor="s-credential" className="label mb-1.5">
            Replace API key
          </label>
          <p className="mb-2 text-[11px] text-slate-400">
            Stored key hint: {credentialHint ?? "not available"}. Replacing a key clears the last
            sync state.
          </p>
          <input
            id="s-credential"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="input font-mono text-xs"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="Paste a new key"
          />
          <button type="submit" disabled={pending !== null || !credential.trim()} className="btn-secondary mt-3 w-full">
            <Icon name="key" className="h-4 w-4" />
            {pending === "credential" ? "Replacing…" : "Replace credential"}
          </button>
        </form>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-xs text-emerald-600">{message}</p> : null}
    </section>
  );
}
