import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="group inline-flex items-center gap-2.5" aria-label="TokenTracker home">
      <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-slate-900 text-white">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true" fill="none">
          <path d="M5 16.5V11h4v5.5M10 16.5V7h4v9.5M15 16.5V9h4v7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">
          TokenTracker
        </span>
      ) : null}
    </Link>
  );
}
