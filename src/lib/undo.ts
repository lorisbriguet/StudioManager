import { toast } from "sonner";
import { useUndoStore, type UndoAction } from "../stores/undo-store";
import { getLabels } from "./notifyError";

/** How long an Undo toast stays up. */
export const UNDO_DURATION = 8000;

/**
 * Show a toast with an undo action. If the user clicks "Undo" within
 * the toast duration, the rollback function is called.
 *
 * Usage:
 *   undoable("Client deleted", async () => { await restoreClient(id, data); });
 */
export function undoable(message: string, rollback: () => Promise<void> | void) {
  const t = getLabels();
  toast(message, {
    action: {
      label: t.undo,
      onClick: async () => {
        try {
          await rollback();
          toast.success(t.action_undone);
        } catch {
          toast.error(t.failed_to_undo);
        }
      },
    },
    duration: UNDO_DURATION,
  });
}

/**
 * Show an undo toast wired to one action of the undo store.
 * Unlike Cmd+Z (which always undoes newest-first), clicking Undo surgically
 * removes THAT specific action from wherever it now sits in the stack,
 * executes it, and arms redo. If the action was already undone via Cmd+Z in
 * the meantime, the click is a no-op. If executing it fails, the action is
 * put back at its original stack position so Cmd+Z can still reach it.
 */
export function undoableAction(message: string, action: UndoAction | undefined): void {
  if (!action) {
    toast.success(message);
    return;
  }
  undoable(message, async () => {
    const store = useUndoStore.getState();
    const idx = store.stack.indexOf(action);
    if (idx === -1) return; // already undone
    // Remove before executing so a concurrent Cmd+Z can't double-run it
    store.remove(action);
    try {
      await action.execute();
    } catch (e) {
      // Failed — restore the action at its original position so it isn't
      // lost from the undo history and Cmd+Z can still reach it
      store.insertUndo(action, idx);
      throw e;
    }
    if (action.redo) {
      store.pushRedo({ label: action.label, execute: action.redo, redo: action.execute });
    }
  });
}

/**
 * The undo toast for the action most recently pushed onto the undo store
 * (delete mutations push before their onSuccess callbacks fire).
 */
export function undoableFromStore(message: string): void {
  undoableAction(message, useUndoStore.getState().stack[0]);
}

/**
 * Delete through a mutation that pushes its own undo entry, then show the
 * Undo toast for it:
 *
 *   deleteWithUndo(deleteExpense, expense.id, t.toast_expense_deleted);
 */
export function deleteWithUndo<Id>(
  mutation: { mutate: (id: Id, options: { onSuccess: () => void }) => void },
  id: Id,
  message: string,
  onSuccess?: () => void
): void {
  mutation.mutate(id, {
    onSuccess: () => {
      undoableFromStore(message);
      onSuccess?.();
    },
  });
}

/**
 * Push an undo entry for a change the caller made itself (no mutation hook
 * pushes one) and show the Undo toast for it:
 *
 *   await deletePreset(id);
 *   pushUndoable(t.preset_deleted, { label: t.delete_preset, execute: () => createPreset(preset) });
 */
export function pushUndoable(message: string, action: UndoAction): void {
  useUndoStore.getState().push(action);
  undoableAction(message, action);
}

/**
 * Run several undoable changes as ONE undo entry (a bulk delete): every
 * action pushed while `run` is in flight is folded into a single one that
 * undoes them all, newest first. Returns that action (undefined when nothing
 * was pushed).
 */
export async function batchUndo(label: string, run: () => Promise<void>): Promise<UndoAction | undefined> {
  const captured: UndoAction[] = [];
  const unsubscribe = useUndoStore.subscribe((s, prev) => {
    const top = s.stack[0];
    if (top && top !== prev.stack[0] && !prev.stack.includes(top)) captured.push(top);
  });
  try {
    await run();
  } finally {
    unsubscribe();
  }
  if (captured.length === 0) return undefined;
  if (captured.length === 1) return captured[0];
  const store = useUndoStore.getState();
  captured.forEach((a) => store.remove(a));
  const undoAll = async () => {
    for (const a of [...captured].reverse()) await a.execute();
  };
  const redoAll = captured.every((a) => a.redo)
    ? async () => {
        for (const a of captured) await a.redo!();
      }
    : undefined;
  const combined: UndoAction = { label, execute: undoAll, redo: redoAll };
  store.push(combined);
  return combined;
}
