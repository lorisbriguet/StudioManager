import { toast } from "sonner";
import { useUndoStore } from "../stores/undo-store";
import { getLabels } from "./notifyError";

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
    duration: 5000,
  });
}

/**
 * Show an undo toast wired to the action most recently pushed onto the undo
 * store (delete mutations push before their onSuccess callbacks fire).
 * Unlike Cmd+Z (which always undoes newest-first), clicking Undo surgically
 * removes THAT specific action from wherever it now sits in the stack,
 * executes it, and arms redo. If the action was already undone via Cmd+Z in
 * the meantime, the click is a no-op. If executing it fails, the action is
 * put back at its original stack position so Cmd+Z can still reach it.
 */
export function undoableFromStore(message: string): void {
  const action = useUndoStore.getState().stack[0];
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
