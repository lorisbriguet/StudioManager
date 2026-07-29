import { ask } from "@tauri-apps/plugin-dialog";
import { getLabels } from "./notifyError";

/**
 * Central registry of "unsaved changes" guards.
 *
 * Pages with dirty form state register a guard (via useUnsavedChangesWarning).
 * Every PROGRAMMATIC navigation site (tab shortcuts in useTabSync, tab-bar
 * clicks, command palette, sidebar keyboard nav) awaits confirmIfDirty()
 * before navigating, so a dirty form is never silently discarded.
 *
 * Anchor clicks, popstate (back/forward) and beforeunload are still handled
 * inside useUnsavedChangesWarning itself.
 */

interface DirtyGuard {
  isDirty: () => boolean;
  markClean: () => void;
}

// Multiple guards possible in principle; in practice one routed page mounts at a time.
const guards = new Set<DirtyGuard>();

// True while a confirmation dialog is open. Concurrent callers (e.g. a held
// Cmd+W key repeating) resolve false instead of stacking dialogs.
let confirming = false;

/**
 * Whether a confirmation dialog is currently open. Lets interceptors with
 * side effects that must NOT run mid-confirm (the popstate history revert
 * in useUnsavedChangesWarning) bail out before acting.
 */
export function isConfirming(): boolean {
  return confirming;
}

/**
 * Register a dirty guard. Returns an unregister function (call on unmount).
 * markClean is invoked after the user confirms leaving, so interceptors that
 * fire during the ensuing navigation don't prompt a second time.
 */
export function registerDirtyGuard(
  isDirty: () => boolean,
  markClean: () => void
): () => void {
  const guard: DirtyGuard = { isDirty, markClean };
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/**
 * Resolve true when navigation may proceed: no registered guard is dirty,
 * the target path equals the current one (same-page no-op — the page stays
 * mounted, nothing is lost), or the user confirmed discarding changes.
 * Resolve false when the user chose to stay, or while a previous
 * confirmation dialog is still open.
 */
export async function confirmIfDirty(targetPath?: string): Promise<boolean> {
  const dirty = [...guards].filter((g) => g.isDirty());
  if (dirty.length === 0) return true;
  if (targetPath !== undefined && targetPath === window.location.pathname) return true;
  if (confirming) return false;
  confirming = true;
  try {
    // Read labels per prompt (not at module load) so a mid-session
    // language switch takes effect.
    const t = getLabels();
    const confirmed = await ask(t.unsaved_changes_message, {
      title: t.unsaved_changes,
      kind: "warning",
      okLabel: t.leave,
      cancelLabel: t.stay,
    });
    if (confirmed) {
      for (const g of dirty) g.markClean();
    }
    return confirmed;
  } catch {
    // Fail closed: if the native dialog errors, treat it as "stay" so no
    // unhandled rejection reaches the void call sites and nothing is lost.
    return false;
  } finally {
    confirming = false;
  }
}
