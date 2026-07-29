import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { logError } from "./log";

/**
 * Translated UI labels for the current app language.
 * Safe to call from plain (non-React) modules — reads the zustand store
 * directly, same pattern as appleCalendar.ts reading calendarName.
 */
export function getLabels() {
  return uiLabels[useAppStore.getState().language];
}

// Deduplicate identical toasts for a short window so repeated failures
// (e.g. per-event calendar sync errors) show at most one toast.
// Logging is never deduplicated — every failure is written to the log.
// The map is never pruned: keys come from a small fixed set of i18n labels,
// so it stays bounded. If you ever pass a dynamic interpolated message,
// reconsider and add pruning.
const recentToasts = new Map<string, number>();
const TOAST_DEDUPE_MS = 30_000;

/**
 * Surface a failure to the user (toast) AND write it to the log.
 * `userMessage` must already be translated: hooks/components pass strings
 * from useT(), plain lib code uses getLabels().
 * Callable from non-React modules (sonner's toast works outside components).
 */
export function notifyError(userMessage: string, err: unknown): void {
  logError(userMessage, err);
  const now = Date.now();
  const last = recentToasts.get(userMessage);
  if (last !== undefined && now - last < TOAST_DEDUPE_MS) return;
  recentToasts.set(userMessage, now);
  toast.error(userMessage);
}
