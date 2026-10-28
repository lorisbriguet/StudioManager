import { invoke } from "@tauri-apps/api/core";

export interface AgentsInfo {
  enabled: boolean;
  claudePath: string | null;
}

export function getAgentsSettings(): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_get_settings");
}

export function setAgentsEnabled(enabled: boolean): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_set_enabled", { enabled });
}

export function startAgent(
  folder: string,
  task: string,
  model: string,
  name: string,
): Promise<string> {
  return invoke<string>("agents_start", { folder, task, model, name });
}

export function stopAgent(shortId: string): Promise<void> {
  return invoke<void>("agents_stop", { shortId });
}

export function deleteAgent(shortId: string): Promise<void> {
  return invoke<void>("agents_delete", { shortId });
}

export function switchModel(sessionId: string, model: string): Promise<string> {
  return invoke<string>("agents_switch_model", { sessionId, model });
}

export type Item =
  | { kind: "user"; text: string; at: string | null }
  | { kind: "assistant"; text: string; at: string | null }
  | { kind: "tool"; name: string; summary: string; at: string | null };

export function conversation(sessionId: string): Promise<Item[]> {
  return invoke<Item[]>("agents_conversation", { sessionId });
}

export function dismissAgent(sessionId: string): Promise<void> {
  return invoke<void>("agents_dismiss", { sessionId });
}

/** Terminal output: `data` is base64 of the raw bytes. */
export const AGENTS_TERM = "agents:term";
/** A terminal's process ended; close its panel. */
export const AGENTS_TERM_EXIT = "agents:term-exit";

export interface TermData {
  termId: number;
  data: string;
}

export interface TermExit {
  termId: number;
}

export function termOpen(shortId: string, cols: number, rows: number): Promise<number> {
  return invoke<number>("agents_term_open", { shortId, cols, rows });
}

/** `data` is the text from xterm's `onData`. */
export function termWrite(termId: number, data: string): Promise<void> {
  return invoke<void>("agents_term_write", { termId, data });
}

export function termResize(termId: number, cols: number, rows: number): Promise<void> {
  return invoke<void>("agents_term_resize", { termId, cols, rows });
}

export function termClose(termId: number): Promise<void> {
  return invoke<void>("agents_term_close", { termId });
}

export function sendMessage(sessionId: string, text: string): Promise<void> {
  return invoke<void>("agents_send", { sessionId, text });
}

export interface PromptOption {
  number: number;
  label: string;
  selected: boolean;
}

/** The prompt a background agent waits on, as read from its terminal. */
export interface Prompt {
  question: string;
  /** What the prompt is about (the command, the file…), one line per screen line. */
  detail: string;
  options: PromptOption[];
  /** Identifies this prompt; pass it back to `answerPrompt`. */
  fingerprint: string;
}

export function getPrompt(shortId: string): Promise<Prompt | null> {
  return invoke<Prompt | null>("agents_prompt", { shortId });
}

/**
 * Refused, and nothing confirmed, when the screen no longer shows the prompt identified by
 * `fingerprint` with option `number` reading `label`.
 */
export function answerPrompt(
  shortId: string,
  number: number,
  label: string,
  fingerprint: string,
): Promise<void> {
  return invoke<void>("agents_answer", { shortId, number, label, fingerprint });
}
