import { create } from "zustand";

interface UndoAction {
  label: string;
  execute: () => Promise<void> | void;
}

interface UndoState {
  stack: UndoAction[];
  push: (action: UndoAction) => void;
  pop: () => UndoAction | undefined;
}

const MAX_STACK = 20;

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  push: (action) =>
    set((s) => ({ stack: [action, ...s.stack].slice(0, MAX_STACK) })),
  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const [action, ...rest] = stack;
    set({ stack: rest });
    return action;
  },
}));
