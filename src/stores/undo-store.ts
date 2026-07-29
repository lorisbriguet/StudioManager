import { create } from "zustand";

interface UndoAction {
  label: string;
  execute: () => Promise<void> | void;
  /** If provided, allows redo after undo */
  redo?: () => Promise<void> | void;
  redirectTo?: string;
}

interface UndoState {
  stack: UndoAction[];
  redoStack: UndoAction[];
  /** Push a new user action onto the undo stack (clears redo history). */
  push: (action: UndoAction) => void;
  /** Push onto the redo stack (does NOT touch the undo stack). */
  pushRedo: (action: UndoAction) => void;
  /**
   * Insert into the undo stack at `index` (clamped) WITHOUT clearing redo
   * history. Used to restore an action after a failed undo, and to hand the
   * inverse action back to the undo stack after a successful redo.
   * Note: inserting at the tail of a full stack drops the INSERTED action
   * (unreachable by current callers — they remove() first, freeing a slot).
   */
  insertUndo: (action: UndoAction, index: number) => void;
  /**
   * Remove a specific action from whichever stack holds it (no-op if absent).
   * Callers remove BEFORE executing so a concurrent trigger (Cmd+Z vs. toast
   * Undo button) can't double-run the same action, then re-insert on failure.
   */
  remove: (action: UndoAction) => void;
}

const MAX_STACK = 20;

export const useUndoStore = create<UndoState>((set) => ({
  stack: [],
  redoStack: [],
  push: (action) =>
    set((s) => ({
      stack: [action, ...s.stack].slice(0, MAX_STACK),
      redoStack: [], // new action clears redo history
    })),
  pushRedo: (action) =>
    set((s) => ({
      redoStack: [action, ...s.redoStack].slice(0, MAX_STACK),
    })),
  insertUndo: (action, index) =>
    set((s) => {
      const i = Math.max(0, Math.min(index, s.stack.length));
      return {
        stack: [...s.stack.slice(0, i), action, ...s.stack.slice(i)].slice(0, MAX_STACK),
      };
    }),
  remove: (action) =>
    set((s) => ({
      stack: s.stack.filter((a) => a !== action),
      redoStack: s.redoStack.filter((a) => a !== action),
    })),
}));
