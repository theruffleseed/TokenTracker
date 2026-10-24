"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { passLabelForPlan, weeklyAllowanceForPlan } from "@/lib/gateway/config";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
        >
          <Icon name={copied ? "check" : "copy"} className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="block break-all rounded-lg bg-slate-50 px-2.5 py-2 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200">
        {value}
      </code>
    </div>
  );
}

export function GatewayEndpoints({
  accountId,
  provider,
  tokenConfigured,
  planName,
}: {
  accountId: string;
  provider: "TOKENHARBOR" | "RIVER_AI";
  tokenConfigured: boolean;
  planName: string | null;
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [pass, setPass] = useState(() => passLabelForPlan(planName)?.toLowerCase() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const openaiBase = `${origin}/api/gateway/${accountId}/v1`;
  const anthropicBase = `${origin}/api/gateway/${accountId}`;
  const allowance = weeklyAllowanceForPlan(planName);

  async function updatePass(next: string) {
    setPass(next);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/providers/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName: next ? `${next[0]?.toUpperCase() ?? ""}${next.slice(1)}` : null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "Could not save the Pass tier");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Usage gateway</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Point an OpenAI- or Anthropic-compatible client at one of these base URLs. TokenTracker
            records usage and estimates spend for requests that pass through it.
          </p>
        </div>
        <Icon name="database" className="h-4 w-4 shrink-0 text-slate-400" />
      </div>

      {!tokenConfigured ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          Create a gateway token in Settings first. The gateway rejects requests without it.
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <CopyRow label="OpenAI-compatible base URL" value={openaiBase} />
        <CopyRow label="Anthropic-compatible base URL" value={anthropicBase} />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Send the gateway token as <code className="font-mono">Authorization: Bearer ttg_…</code>{" "}
        or <code className="font-mono">x-api-key</code>. The provider key stays encrypted on the
        server and is never sent to the client.
      </p>

      {provider === "TOKENHARBOR" ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <label htmlFor={`pass-${accountId}`} className="label mb-1.5">
            Pass tier (weekly estimate)
          </label>
          <select
            id={`pass-${accountId}`}
            className="input"
            value={pass}
            disabled={saving}
            onChange={(event) => updatePass(event.target.value)}
          >
            <option value="">Not set</option>
            <option value="agent">Agent · $2.50/week</option>
            <option value="office">Office · $8.75/week</option>
            <option value="frontier">Frontier · $45.00/week</option>
          </select>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {allowance
              ? `Gateway spend is converted to the weekly paid-model window using the $${allowance.toFixed(2)} published allowance.`
              : "Set a Pass tier to estimate the weekly paid-model window. Balances are still adjusted without it."}
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-[11px] text-rose-600">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
        Traffic sent directly to {provider === "TOKENHARBOR" ? "TokenHarbor" : "River"} with the
        provider key bypasses this gateway and is not measured. Estimates use published list
        prices, so they can differ from the vendor invoice.
      </p>
    </section>
  );
}
