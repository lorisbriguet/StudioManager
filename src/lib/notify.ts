import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { logError } from "./log";
import { isAppError } from "./errors";

/**
 * The one way to show a toast. See "Toasts" in DESIGN-SYSTEM.md.
 * Only this file and `components/ui/Toaster.tsx` import sonner (ESLint
 * `no-restricted-imports`). Callable from non-React code.
 *
 *   notify.success(t.invoice_saved);
 *   notify.error(t.error_save_invoice, err);           // label shown, raw error logged + "Details"
 *   notify.undo(t.expense_deleted, () => restore());
 *   await notify.progress(t.generating_pdf, work(), { success: t.pdf_downloaded, error: t.error_generate_pdf });
 */

/** How long each kind of toast stays up (ms). */
export const TOAST_DURATION = {
  success: 4000,
  info: 4000,
  warning: 8000,
  error: 10_000,
  undo: 8000,
} as const;

/**
 * Translated UI labels for the current app language.
 * Safe to call from plain (non-React) modules — reads the zustand store directly.
 */
export function getLabels() {
  return uiLabels[useAppStore.getState().language];
}

// The same error label shows at most once per window, so repeated failures
// (e.g. per-event calendar sync errors) don't stack toasts. Logging is never
// deduplicated. Keys are translated labels (a small fixed set), so the map
// stays bounded.
const recentErrors = new Map<string, number>();
const ERROR_DEDUPE_MS = 30_000;

/** Test helper: forget which errors were shown recently. */
export function resetNotifyDedupe(): void {
  recentErrors.clear();
}

/** The raw text of an error, for the log and the "Details" copy. Never shown in a toast. */
export function errorDetails(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

function detailsAction(err: unknown) {
  const t = getLabels();
  return {
    label: t.copy_details,
    onClick: () => {
      navigator.clipboard?.writeText(errorDetails(err)).catch(() => {});
    },
  };
}

function showError(label: string, err: unknown, hasErr: boolean, description?: string): void {
  const now = Date.now();
  const last = recentErrors.get(label);
  if (last !== undefined && now - last < ERROR_DEDUPE_MS) return;
  recentErrors.set(label, now);
  toast.error(label, {
    duration: TOAST_DURATION.error,
    description,
    action: hasErr ? detailsAction(err) : undefined,
  });
}

export const notify = {
  /** Something the user did worked: "Invoice saved". */
  success(message: string, opts?: { description?: string }): void {
    toast.success(message, { duration: TOAST_DURATION.success, description: opts?.description });
  },

  /** Neutral news: "No recurring invoices due". */
  info(message: string): void {
    toast.info(message, { duration: TOAST_DURATION.info });
  },

  /** Worked, but something needs a look: "2 receipts skipped". */
  warning(message: string, opts?: { description?: string }): void {
    toast.warning(message, { duration: TOAST_DURATION.warning, description: opts?.description });
  },

  /**
   * Something failed. Shows the translated `label` ("Couldn't save the
   * invoice"), never the raw error: that goes to the log, and a "Details"
   * action copies it. The same label shows once per 30 s. An `AppError`
   * (lib/errors.ts) carries a more telling label ("Expenses use this
   * category"): that one is shown instead. `description` adds a second line
   * ("No changes were made").
   */
  error(label: string, err?: unknown, opts?: { description?: string }): void {
    const hasErr = err !== undefined;
    const shown = isAppError(err) ? getLabels()[err.labelKey] : label;
    if (hasErr) logError(shown, errorDetails(err));
    else logError(shown);
    showError(shown, err, hasErr, opts?.description);
  },

  /**
   * A reversible change: the message with an Undo action, 8 s. Clicking Undo
   * runs `onUndo`, then says "Action undone" (or reports the failure).
   */
  undo(message: string, onUndo: () => Promise<void> | void): void {
    const t = getLabels();
    toast(message, {
      duration: TOAST_DURATION.undo,
      action: {
        label: t.undo,
        onClick: async () => {
          try {
            await onUndo();
            notify.success(t.action_undone);
          } catch (e) {
            notify.error(t.failed_to_undo, e);
          }
        },
      },
    });
  },

  /**
   * One toast for a long task: `label` (a spinner) while it runs, replaced by
   * the outcome in place. `success` is a message, null to just close, a
   * `{ warning }` for a partial result, or a function of the result giving
   * one of those. A failure shows the `error` label (raw error logged,
   * "Details" copies it). `work` may take `update(label)` to change the
   * running text ("Exporting 3 of 10…"). Resolves to the result, or undefined
   * when it failed — already reported, don't report it again.
   */
  async progress<T>(
    label: string,
    work: Promise<T> | ((update: (label: string) => void) => Promise<T>),
    msgs: { success: ProgressOutcome | ((result: T) => ProgressOutcome); error: string }
  ): Promise<T | undefined> {
    const id = toast.loading(label);
    const update = (next: string) => {
      toast.loading(next, { id });
    };
    try {
      const result = await (typeof work === "function" ? work(update) : work);
      const outcome = typeof msgs.success === "function" ? msgs.success(result) : msgs.success;
      if (outcome === null) toast.dismiss(id);
      else if (typeof outcome === "string") toast.success(outcome, { id, duration: TOAST_DURATION.success });
      else toast.warning(outcome.warning, { id, duration: TOAST_DURATION.warning });
      return result;
    } catch (err) {
      const shown = isAppError(err) ? getLabels()[err.labelKey] : msgs.error;
      logError(shown, errorDetails(err));
      toast.error(shown, { id, duration: TOAST_DURATION.error, action: detailsAction(err) });
      return undefined;
    }
  },
};

/** How a `notify.progress` task ends: a success message, null (just close), or a warning. */
export type ProgressOutcome = string | null | { warning: string };
