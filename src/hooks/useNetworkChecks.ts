import { useCallback, useEffect, useRef, useState } from "react";
import { networkCheck, type CheckResult, type CheckTarget } from "../lib/network/commands";
import { useAppStore } from "../stores/app-store";

const EVERY_MS = 300_000;
const BATCH = 32;

/**
 * Status checks for the Network page: on mount, on refresh() and every 5 minutes while mounted.
 * Skipped in test and presentation mode, never overlapping, and never notifying.
 * A failed call leaves its rows as "not checked".
 */
export function useNetworkChecks(targets: CheckTarget[]) {
  const skip = useAppStore((s) => s.testMode || s.presentationMode);
  const [results, setResults] = useState<Map<string, CheckResult>>(new Map());
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const running = useRef(false);
  const pending = useRef(false);
  const alive = useRef(true);
  const latest = useRef(targets);
  latest.current = targets;
  const signature = JSON.stringify(targets);

  const refresh = useCallback(async (): Promise<void> => {
    const list = latest.current;
    if (skip || list.length === 0) return;
    if (running.current) {
      // Targets may have changed mid-run: go again once, with the latest, when this one ends.
      pending.current = true;
      return;
    }
    running.current = true;
    setChecking(true);
    try {
      const next = new Map<string, CheckResult>();
      let ok = false;
      for (let i = 0; i < list.length; i += BATCH) {
        try {
          for (const r of await networkCheck(list.slice(i, i + BATCH))) next.set(r.key, r);
          ok = true;
        } catch {
          // Rows of a failed batch stay "not checked".
        }
      }
      if (ok && alive.current) {
        setResults(next);
        setCheckedAt(Date.now());
      }
    } finally {
      running.current = false;
      if (alive.current) setChecking(false);
      if (pending.current && alive.current) {
        pending.current = false;
        void refresh();
      }
    }
  }, [skip]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), EVERY_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh, signature]);

  return { results, checkedAt, checking, refresh: () => void refresh() };
}
