import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Brand />
      <h1 className="mt-8 text-xl font-semibold text-slate-900">You are offline</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        TokenTracker needs a connection to refresh quota and show current balances. Reconnect and
        try again.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6">
        Retry
      </Link>
      <p className="mt-6 text-[11px] text-slate-400">
        Cached quota values are not shown while offline because they may be stale.
      </p>
    </main>
  );
}
