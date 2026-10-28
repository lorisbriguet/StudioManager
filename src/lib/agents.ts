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
