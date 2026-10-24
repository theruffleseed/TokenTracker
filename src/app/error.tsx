"use client";

import Link from "next/link";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Error</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        The dashboard could not finish loading. Your stored data was not changed.
      </p>
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/dashboard" className="btn-secondary">
          Overview
        </Link>
      </div>
    </main>
  );
}
