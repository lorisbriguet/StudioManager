import { useEffect, useState } from "react";
import { watcherStatus, type WatcherStatus } from "../lib/agents";

/**
 * The watcher's status, read now and every 30 s (the watcher passes as often). Null before the
 * first answer and while it can't be read (Agents off).
 */
export function useWatcherStatus(): WatcherStatus | null {
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      watcherStatus()
        .then((s) => { if (!cancelled) setStatus(s ?? null); })
        .catch(() => { if (!cancelled) setStatus(null); });
    void read();
    const timer = setInterval(read, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return status;
}
