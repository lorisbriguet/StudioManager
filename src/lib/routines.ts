import { invoke } from "@tauri-apps/api/core";

/** Emitted when the routines or a run change (no payload). */
export const ROUTINES_CHANGED = "routines:changed";

export interface RoutineLink {
  label: string;
  /** An absolute path or an http(s) URL. */
  target: string;
}

export interface Section {
  /** "" for a new section; Rust gives it an id on save. */
  id: string;
  name: string;
  links: RoutineLink[];
}

/** The prompt text itself, or a file the agent reads at run time. */
export type RoutinePrompt = { text: string } | { file: string };

export type RoutineKind =
  | { kind: "agent"; folder: string; model: string; name: string; prompt: RoutinePrompt }
  /** argv only, never a shell; `program` and `cwd` are absolute. */
  | { kind: "command"; program: string; args: string[]; cwd: string };

export interface Schedule {
  /** `HH:MM`, 24 h. */
  time: string;
  days: "daily" | "weekdays";
}

export interface Routine {
  /** "" for a new routine; Rust gives it an id on save. */
  id: string;
  /** The saved id of its section. */
  sectionId: string;
  title: string;
  idleHint: string;
  kind: RoutineKind;
  resultLink: string | null;
  schedule: Schedule | null;
}

export interface Routines {
  sections: Section[];
  routines: Routine[];
}

export type RunStatus = "running" | "done" | "failed";

/** The last run of a routine. */
export interface Run {
  routineId: string;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms; null while running. */
  finishedAt: number | null;
  status: RunStatus;
  /** A command's last output line, or why the run failed. */
  message: string | null;
  /** The agent an agent routine started. */
  agentShortId: string | null;
  /** `YYYY-MM-DD` of the scheduled run; null for a run started by hand. */
  scheduledFor: string | null;
}

export function getRoutines(): Promise<Routines> {
  return invoke<Routines>("routines_get");
}

/** Validates and saves all routines; returns them with the new ids. */
export function saveRoutines(routines: Routines): Promise<Routines> {
  return invoke<Routines>("routines_save", { routines });
}

/** Runs a saved routine by its id. A command routine comes back `running`. */
export function runRoutine(id: string): Promise<Run> {
  return invoke<Run>("routines_run", { id });
}

export function getRoutineRuns(): Promise<Run[]> {
  return invoke<Run[]>("routines_runs");
}
