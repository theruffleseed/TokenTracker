"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PROVIDER_LIST } from "@/lib/providers/catalog";
import type { ProviderKey } from "@/lib/schemas";
import { Icon } from "./icons";

const WINDOW_LABELS: Record<string, string> = {
  rolling_5h: "5-hour",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  other: "Other",
};

export function AddProviderForm({ experimentalEnabled }: { experimentalEnabled: boolean }) {
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderKey>("OPENCODE_GO");
  const [authMode, setAuthMode] = useState<"LIVE" | "MANUAL">(
    experimentalEnabled ? "LIVE" : "MANUAL",
  );
  const [displayName, setDisplayName] = useState("OpenCode Go");
  const [planName, setPlanName] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [interval, setInterval] = useState("30");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const entry = useMemo(
    () => PROVIDER_LIST.find((item) => item.key === provider) ?? PROVIDER_LIST[0]!,
    [provider],
  );

  const liveBlocked = entry.capabilities.experimental && !experimentalEnabled;
  const supportsLive = entry.capabilities.connectionProbe;
  const needsCredential = authMode === "LIVE" && provider !== "QODER";

  function chooseProvider(key: ProviderKey) {
    setProvider(key);
    const next = PROVIDER_LIST.find((item) => item.key === key);
    if (next) {
      setDisplayName(next.name);
      setError(null);
      setFieldErrors({});
      const blocked = next.capabilities.experimental && !experimentalEnabled;
      if (blocked) setAuthMode("MANUAL");
      else if (authMode === "LIVE" && !next.capabilities.connectionProbe) setAuthMode("MANUAL");
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    if (needsCredential && !credential.trim()) {
      setFieldErrors({ credential: "Enter the provider API key" });
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          displayName,
          authMode,
          credential: needsCredential ? credential.trim() : undefined,
          planName: planName.trim() || undefined,
          accountLabel: accountLabel.trim() || undefined,
          refreshIntervalMin: Number(interval) || 30,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            account?: { id: string };
            error?: { message?: string; details?: Array<{ path: string; message: string }> };
          }
        | null;

      if (!response.ok || !body?.account?.id) {
        setError(body?.error?.message ?? "Could not add this provider.");
        if (body?.error?.details) {
          setFieldErrors(
            Object.fromEntries(body.error.details.map((detail) => [detail.path, detail.message])),
          );
        }
        return;
      }

      router.push(`/providers/${body.account.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">1. Choose a provider</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PROVIDER_LIST.map((item) => {
              const active = item.key === provider;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => chooseProvider(item.key)}
                  aria-pressed={active}
                  className={`rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{item.name}</span>
                    {item.capabilities.experimental ? (
                      <span className="badge bg-amber-50 text-amber-700 ring-amber-200">Alpha API</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.blurb}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">2. Connection method</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAuthMode("LIVE")}
              disabled={!supportsLive || liveBlocked}
              aria-pressed={authMode === "LIVE"}
              className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                authMode === "LIVE"
                  ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Icon name="key" className="h-4 w-4" />
                Live connection
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                {liveBlocked
                  ? "Disabled by server configuration. Experimental adapters are off."
                  : provider === "QODER"
                    ? "Use the Qoder CLI session on this machine; no key is stored."
                    : "Store an encrypted, read-only API key and refresh on a schedule."}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setAuthMode("MANUAL")}
              aria-pressed={authMode === "MANUAL"}
              className={`rounded-xl border p-3 text-left transition ${
                authMode === "MANUAL"
                  ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Icon name="database" className="h-4 w-4" />
                Manual tracking
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                No key stored. You enter quota and balance snapshots yourself.
              </span>
            </button>
          </div>

          {authMode === "LIVE" &&
          !entry.capabilities.quotaWindows.length &&
          !entry.capabilities.creditBalance ? (
            <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
              {entry.name} has no documented quota or balance API. A live key only verifies the
              connection; continue with manual snapshots for the numbers.
            </p>
          ) : null}

          {authMode === "LIVE" && provider === "QODER" ? (
            <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
              Uses the Qoder CLI session already authorized on this machine. No key is stored. If
              the session expires, run{" "}
              <code className="font-mono">qodercli login</code> on the host.
            </p>
          ) : null}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-slate-900">3. Details</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="displayName" className="label mb-1.5">
                Display name
              </label>
              <input
                id="displayName"
                className="input"
                required
                maxLength={80}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              {fieldErrors.displayName ? (
                <p className="mt-1 text-xs text-rose-600">{fieldErrors.displayName}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="planName" className="label mb-1.5">
                Plan <span className="font-normal normal-case text-slate-400">(optional)</span>
              </label>
              <input
                id="planName"
                className="input"
                maxLength={80}
                placeholder={
                  entry.key === "TOKENHARBOR"
                    ? "Office Pass"
                    : entry.key === "QODER"
                      ? "Pro"
                      : entry.key === "YETA"
                        ? "Prepaid"
                        : "Go Plus"
                }
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="accountLabel" className="label mb-1.5">
                Account label <span className="font-normal normal-case text-slate-400">(optional)</span>
              </label>
              <input
                id="accountLabel"
                className="input"
                maxLength={160}
                placeholder="Work workspace, team account…"
                value={accountLabel}
                onChange={(event) => setAccountLabel(event.target.value)}
              />
            </div>

            <div>
              <label htmlFor="interval" className="label mb-1.5">
                Refresh every
              </label>
              <select
                id="interval"
                className="input"
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="180">3 hours</option>
                <option value="720">12 hours</option>
                <option value="1440">24 hours</option>
              </select>
            </div>
          </div>

          {authMode === "LIVE" && provider !== "QODER" ? (
            <div>
              <label htmlFor="credential" className="label mb-1.5">
                {entry.authLabel}
              </label>
              <input
                id="credential"
                className="input font-mono text-xs"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={
                  entry.key === "OPENCODE_GO"
                    ? "oc_sk_…"
                    : entry.key === "YETA"
                      ? "sk-…"
                      : "Paste the API key"
                }
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                Encrypted with AES-256-GCM before storage and never returned by the API. The key
                must be read-only where the provider supports scoped keys.
              </p>
              {fieldErrors.credential ? (
                <p className="mt-1 text-xs text-rose-600">{fieldErrors.credential}</p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "Adding…" : authMode === "LIVE" ? "Add and verify" : "Add provider"}
            </button>
            <Link href="/dashboard" className="btn-ghost">
              Cancel
            </Link>
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">What {entry.name} supports</h2>
          <dl className="mt-3 space-y-3 text-xs">
            <div>
              <dt className="font-medium text-slate-500">Quota windows</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {entry.capabilities.quotaWindows.length > 0 ? (
                  entry.capabilities.quotaWindows.map((window) => (
                    <span key={window} className="badge bg-slate-100 text-slate-600 ring-slate-200">
                      {WINDOW_LABELS[window] ?? window}
                    </span>
                  ))
                ) : (
                  <span className="badge bg-slate-100 text-slate-500 ring-slate-200">
                    Not supported live
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">Credit balance</dt>
              <dd className="font-medium text-slate-700">
                {entry.capabilities.creditBalance ? "Live" : "Manual only"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">Model-specific limits</dt>
              <dd className="font-medium text-slate-700">
                {entry.capabilities.modelScopes ? "Supported" : "Not available"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">Usage history</dt>
              <dd className="font-medium text-slate-700">
                {entry.capabilities.usageHistory ? "Supported" : "Not available"}
              </dd>
            </div>
          </dl>

          <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            {entry.capabilityNotes.map((note) => (
              <li key={note} className="flex gap-2 text-[11px] leading-relaxed text-slate-500">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                {note}
              </li>
            ))}
          </ul>

          <a
            href={entry.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 underline underline-offset-2"
          >
            Provider documentation
            <Icon name="external" className="h-3.5 w-3.5" />
          </a>
        </section>

        <p className="px-1 text-[11px] leading-relaxed text-slate-400">
          Live connections are read-only. TokenTracker never makes paid inference requests to
          measure quota, and provider failures are isolated per account.
        </p>
      </aside>
    </form>
  );
}
