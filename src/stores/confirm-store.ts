import { create } from "zustand";
import type { ReactNode } from "react";

/**
 * The app's confirmation dialogs (see DESIGN-SYSTEM.md, "Confirmations").
 *
 * `confirm()` opens a ConfirmDialog and resolves when the person answers: true
 * for the verb button, false for Cancel / Esc / the backdrop, or the extra
 * choice's `value`. Callable from anywhere (hooks, lib code, the dirty guard);
 * the one <ConfirmHost/> mounted in App renders the dialogs. Requests made
 * while one is open wait their turn.
 */
export interface ConfirmOptions<E extends string = string> {
  /** The question, with its object: "Delete Atelier?" */
  title: string;
  /** What happens, in a sentence or two. */
  message?: ReactNode;
  /** The verb on the button: "Delete", "Restore", "Leave". */
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** danger: the verb button is red. */
  tone?: "danger" | "default";
  /** The verb stays disabled until this exact text is typed (whole-org deletes). */
  requireText?: string;
  /** A third answer between Cancel and the verb; resolves to its `value`. */
  extra?: { label: string; value: E };
}

export type ConfirmResult<E extends string = string> = boolean | E;

interface PendingConfirm {
  id: number;
  options: ConfirmOptions;
  resolve: (answer: ConfirmResult) => void;
}

interface ConfirmState {
  queue: PendingConfirm[];
  /** Resolve the open dialog and show the next one. */
  answer: (id: number, value: ConfirmResult) => void;
}

let nextId = 1;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],
  answer: (id, value) => {
    const item = get().queue.find((q) => q.id === id);
    if (!item) return;
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
    item.resolve(value);
  },
}));

export function confirm(options: ConfirmOptions & { extra?: undefined }): Promise<boolean>;
export function confirm<E extends string>(options: ConfirmOptions<E>): Promise<ConfirmResult<E>>;
export function confirm(options: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    const id = nextId++;
    useConfirmStore.setState((s) => ({ queue: [...s.queue, { id, options, resolve }] }));
  });
}
