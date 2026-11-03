import { create } from "zustand";
import { useOrgStore } from "./org-store";

export interface UndoAction {
  label: string;
  execute: () => Promise<void> | void;
  /** If provided, allows redo after undo */
  redo?: () => Promise<void> | void;
  redirectTo?: string;
  /** Organisation active when the action was pushed (stamped by the store). */
  orgId?: string;
}

/**
 * Stamp an action with the active organisation and make it inert in any other
 * one: ids in one organisation's database mean other rows in another's.
 */
function stamp(action: UndoAction): UndoAction {
  if (action.orgId !== undefined) return action;
  const orgId = useOrgStore.getState().activeId;
  action.orgId = orgId;
  const run = (f: () => Promise<void> | void) => () =>
    useOrgStore.getState().activeId === orgId ? f() : undefined;
  action.execute = run(action.execute);
  if (action.redo) action.redo = run(action.redo);
  return action;
}

/** True when the action belongs to another organisation than the active one. */
export function isForeignAction(action: UndoAction): boolean {
  return action.orgId !== undefined && action.orgId !== useOrgStore.getState().activeId;
}

/** Empty both stacks (used when the organisation changes). */
export function clearUndoHistory(): void {
  useUndoStore.setState({ stack: [], redoStack: [] });
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
      stack: [stamp(action), ...s.stack].slice(0, MAX_STACK),
      redoStack: [], // new action clears redo history
    })),
  pushRedo: (action) =>
    set((s) => ({
      redoStack: [stamp(action), ...s.redoStack].slice(0, MAX_STACK),
    })),
  insertUndo: (action, index) =>
    set((s) => {
      const i = Math.max(0, Math.min(index, s.stack.length));
      return {
        stack: [...s.stack.slice(0, i), stamp(action), ...s.stack.slice(i)].slice(0, MAX_STACK),
      };
    }),
  remove: (action) =>
    set((s) => ({
      stack: s.stack.filter((a) => a !== action),
      redoStack: s.redoStack.filter((a) => a !== action),
    })),
}));
