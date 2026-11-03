import { create } from "zustand";
import { useOrgStore } from "./org-store";

/**
 * Half-typed titles of new tasks and subtasks, kept in memory only so they
 * survive leaving the page or collapsing a task. Gone when the app closes;
 * never written to the database. Empty text is not stored.
 */
interface DraftState {
  drafts: Record<string, string>;
  set: (key: string, text: string) => void;
  /** Clears only if the draft still reads `text` (a newer keystroke wins over a slow create). */
  clearIf: (key: string, text: string) => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: {},
  set: (key, text) =>
    set((s) => {
      const next = { ...s.drafts };
      if (text) next[key] = text;
      else delete next[key];
      return { drafts: next };
    }),
  clearIf: (key, text) => {
    if (get().drafts[key] === text) get().set(key, "");
  },
}));

/** Builds draft keys for the add-task row of a project and the add-subtask row of a task, per organisation (ids repeat between them). */
export function useDraftKeys(): (kind: "task" | "subtask", id: number) => string {
  const org = useOrgStore((s) => s.activeId) ?? "";
  return (kind, id) => `${org}:${kind}:${id}`;
}
