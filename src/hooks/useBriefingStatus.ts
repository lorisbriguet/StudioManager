import { useEffect, useState } from "react";
import { briefingStatus, type BriefingStatus } from "../lib/agents";

/**
 * The brief session's status, read now and every 30 s while `active` (the scheduler checks as
 * often). Null before the first answer, and while it can't be read (Agents off).
 */
export function useBriefingStatus(active: boolean): BriefingStatus | null {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const read = () =>
      briefingStatus()
        .then((s) => { if (!cancelled) setStatus(s ?? null); })
        .catch(() => { if (!cancelled) setStatus(null); });
    void read();
    const timer = setInterval(read, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);
  return active ? status : null;
}
