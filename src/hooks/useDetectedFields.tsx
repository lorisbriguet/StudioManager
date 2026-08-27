import { useState, useCallback, type ReactNode } from "react";
import { DetectedBadge } from "../components/DetectedBadge";

/**
 * Tracks which form fields still hold an untouched OCR-detected value and
 * renders their "from receipt" badges. Shared by the expense and income
 * forms — the field unions differ, the behavior must not.
 */
export function useDetectedFields<F extends string>(initial: () => Set<F>) {
  const [detected, setDetected] = useState<Set<F>>(initial);

  const undetect = useCallback(
    (field: F) =>
      setDetected((prev) => {
        if (!prev.has(field)) return prev;
        const next = new Set(prev);
        next.delete(field);
        return next;
      }),
    []
  );

  /** Re-sync after a new prefill arrives (new file dropped on an open form).
   *  Stable identity — safe to list in effect dependency arrays. */
  const resetDetected = useCallback((next: Set<F>) => setDetected(next), []);

  /** Badge + clear for a detected field; `reset` restores the manual default. */
  const detectedBadge = (field: F, reset: () => void): ReactNode =>
    detected.has(field) ? (
      <DetectedBadge
        onClear={() => {
          reset();
          undetect(field);
        }}
      />
    ) : undefined;

  const detectedClass = (field: F) =>
    detected.has(field) ? "!border-[var(--color-accent)]" : "";

  return { undetect, resetDetected, detectedBadge, detectedClass };
}
