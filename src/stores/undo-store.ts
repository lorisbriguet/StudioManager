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
  push: (action: UndoAction) => void;
  pop: () => UndoAction | undefined;
  popRedo: () => UndoAction | undefined;
  pushRedo: (action: UndoAction) => void;
}

const MAX_STACK = 20;

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  redoStack: [],
  push: (action) =>
    set((s) => ({
      stack: [action, ...s.stack].slice(0, MAX_STACK),
      redoStack: [], // new action clears redo history
    })),
  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const [action, ...rest] = stack;
    set({ stack: rest });
    return action;
  },
  pushRedo: (action) =>
    set((s) => ({
      redoStack: [action, ...s.redoStack].slice(0, MAX_STACK),
    })),
  popRedo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return undefined;
    const [action, ...rest] = redoStack;
    set({ redoStack: rest });
    return action;
  },
}));
