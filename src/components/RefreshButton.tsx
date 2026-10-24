"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

export function RefreshButton({
  accountId,
  label = "Refresh",
  compact = false,
}: {
  accountId: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function refresh() {
    setPending(true);
    setMessage(null);
    setError(false);

    try {
      const response = await fetch(`/api/providers/${accountId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json().catch(() => null)) as
        | {
            outcome?: { status?: string; code?: string };
            error?: { message?: string };
          }
        | null;

      if (!response.ok) {
        setError(true);
        setMessage(body?.error?.message ?? "Refresh failed");
        return;
      }

      const status = body?.outcome?.status;
      if (status === "succeeded") setMessage("Refreshed");
      else if (status === "failed") {
        setError(true);
        setMessage(`Refresh failed (${body?.outcome?.code ?? "unknown"})`);
      } else if (status === "already_running") setMessage("Refresh already running");
      else setMessage("Refresh queued");

      router.refresh();
    } catch {
      setError(true);
      setMessage("Could not reach the server");
    } finally {
      setPending(false);
      window.setTimeout(() => setMessage(null), 5000);
    }
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
          aria-label={pending ? "Refreshing" : "Refresh now"}
          title="Refresh now"
        >
          <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        </button>
        {message ? (
          <span className={`text-[11px] ${error ? "text-rose-600" : "text-slate-500"}`} role="status">
            {message}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={refresh} disabled={pending} className="btn-secondary">
        <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Refreshing…" : label}
      </button>
      {message ? (
        <span className={`text-xs ${error ? "text-rose-600" : "text-slate-500"}`} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
