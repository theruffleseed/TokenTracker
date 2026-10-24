"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";
import { RefreshButton } from "./RefreshButton";

export function ProviderActions({
  accountId,
  isActive,
  authMode,
}: {
  accountId: string;
  isActive: boolean;
  authMode: "LIVE" | "MANUAL";
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"pause" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setPending("pause");
    setError(null);
    try {
      const response = await fetch(`/api/providers/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not update this connection");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect this provider and delete its snapshots? This cannot be undone.")) {
      return;
    }
    setPending("delete");
    setError(null);
    try {
      const response = await fetch(`/api/providers/${accountId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not disconnect this provider");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {authMode === "LIVE" ? <RefreshButton accountId={accountId} label="Refresh now" /> : null}
        <button type="button" onClick={toggleActive} disabled={pending !== null} className="btn-secondary">
          {pending === "pause" ? "Saving…" : isActive ? "Pause" : "Resume"}
        </button>
        <button type="button" onClick={disconnect} disabled={pending !== null} className="btn-danger">
          <Icon name="trash" className="h-4 w-4" />
          {pending === "delete" ? "Removing…" : "Disconnect"}
        </button>
      </div>
      {!isActive ? (
        <p className="text-[11px] text-amber-600">Paused connections do not refresh on schedule.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
