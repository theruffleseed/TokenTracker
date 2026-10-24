"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/quota";

export function Countdown({ target }: { target: string | null }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (!target) {
    return <span className="text-slate-400">Reset time unavailable</span>;
  }

  // Avoid an SSR/client hydration mismatch on the first paint.
  if (!now) {
    return <span className="text-slate-400">Resets soon</span>;
  }

  const expired = new Date(target).getTime() <= now.getTime();
  return (
    <span className={expired ? "font-medium text-amber-600" : ""}>
      {expired ? "Reset due" : `Resets in ${formatCountdown(target, now)}`}
    </span>
  );
}
