"use client";

import { useState } from "react";
import { Icon } from "./icons";

interface IssuedToken {
  token: string;
  hint: string;
  createdAt: string;
}

export function GatewaySettings({
  hint,
  createdAt,
}: {
  hint: string | null;
  createdAt: string | null;
}) {
  const [current, setCurrent] = useState({ hint, createdAt });
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    if (current.hint && !window.confirm("Rotate the token? Existing clients will stop working until you update them.")) {
      return;
    }
    setPending(true);
    setError(null);
    setIssued(null);
    setCopied(false);

    try {
      const response = await fetch("/api/settings/gateway-token", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | (IssuedToken & { error?: { message?: string } })
        | null;
      if (!response.ok || !body?.token) {
        setError(body?.error?.message ?? "Could not create a gateway token");
        return;
      }
      setIssued(body);
      setCurrent({ hint: body.hint, createdAt: body.createdAt });
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    if (!window.confirm("Revoke the gateway token? Gateway clients will fail with 401.")) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/gateway-token", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "Could not revoke the token");
        return;
      }
      setIssued(null);
      setCurrent({ hint: null, createdAt: null });
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard access was blocked. Select and copy the token manually.");
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">Usage gateway</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Route an OpenAI- or Anthropic-compatible client through TokenTracker to record token
        usage and estimate spend automatically. The token below is separate from provider keys and
        is only stored as a hash.
      </p>

      {issued ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[11px] font-semibold text-amber-900">
            Copy this token now. It is shown only once.
          </p>
          <code className="mt-2 block break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] text-slate-800 ring-1 ring-amber-200">
            {issued.token}
          </code>
          <button type="button" onClick={copy} className="btn-secondary mt-2 w-full text-xs">
            <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy token"}
          </button>
        </div>
      ) : current.hint ? (
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500">Token</dt>
            <dd className="font-mono font-medium text-slate-700">{current.hint}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-500">Created</dt>
            <dd className="font-medium text-slate-700">
              {current.createdAt ? new Date(current.createdAt).toLocaleDateString() : "—"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          No gateway token yet. Create one, then copy a provider&apos;s gateway URL from its detail
          page.
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <button type="button" onClick={issue} disabled={pending} className="btn-secondary w-full">
          <Icon name="key" className="h-4 w-4" />
          {pending ? "Working…" : current.hint ? "Rotate token" : "Create gateway token"}
        </button>
        {current.hint ? (
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className="text-[11px] font-medium text-rose-600 underline underline-offset-2 hover:text-rose-700"
          >
            Revoke token
          </button>
        ) : null}
      </div>

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
        Only traffic sent through the gateway is measured. Requests made directly to the provider
        with its own key are not counted. Costs are estimates from public list prices.
      </p>
    </section>
  );
}
