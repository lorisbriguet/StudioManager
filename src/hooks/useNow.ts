import { useEffect, useState } from "react";

/**
 * The current time in ms, refreshed every `intervalMs` (default one minute). Use it where
 * render needs "now" (ages, days left, "checked … ago"): calling Date.now() during render
 * is impure, and the interval keeps the value true while the screen stays open.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
