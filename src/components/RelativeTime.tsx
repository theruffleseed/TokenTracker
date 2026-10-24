"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/quota";

export function RelativeTime({ value }: { value: string | null }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  if (!value) return <span>Never</span>;
  if (!now) return <span>—</span>;
  return <span>{formatRelative(value, now)}</span>;
}
