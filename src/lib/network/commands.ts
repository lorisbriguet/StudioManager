import { invoke } from "@tauri-apps/api/core";
import { equipmentOrgId } from "../../db";

export type CheckKind = "http" | "tcp";
export type CheckState = "up" | "unreachable" | "error";

export interface CheckTarget {
  key: string;
  kind: CheckKind;
  url: string;
  /** The connection's certificate fingerprint (hex SHA-256), when one is stored. */
  pin?: string | null;
}

export interface CheckResult {
  key: string;
  state: CheckState;
  /** "http_502"-style for a 5xx, "certificate" for a TLS failure. */
  reason: string | null;
}

/** Check up to 32 targets at once. Empty in test and presentation modes. */
export async function networkCheck(targets: CheckTarget[]): Promise<CheckResult[]> {
  return invoke<CheckResult[]>("network_check", { targets });
}

/** Open a machine's remote link (Screen Sharing, Jump Desktop). The URL is read from the database by id. */
export async function openRemoteLink(fileId: number): Promise<void> {
  await invoke("open_remote_link", { targetOrg: equipmentOrgId(), fileId });
}
