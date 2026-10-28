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
