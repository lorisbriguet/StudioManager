import { useEffect, useState } from "react";

/**
 * The current time in ms, refreshed every `intervalMs` (default one minute) while `enabled`.
 * Use it where render needs "now" (ages, days left, "checked … ago"): calling Date.now()
 * during render is impure, and the interval keeps the value true while the screen stays
 * open. While disabled nothing ticks; once enabled again the value stays the old one until
 * the first tick, `intervalMs` later (clamp what it measures if that matters).
 */
export function useNow(intervalMs = 60_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
