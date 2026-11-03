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

/** This Mac's Time Machine, as the Rust side reads it. */
export interface TimeMachineStatus {
  enabled: boolean;
  /** Newest snapshot of the last-used destination (ISO 8601), null before the first completed backup. */
  lastBackupAt: string | null;
  /** The destination's last result code; 0 is success. */
  lastResult: number | null;
  running: boolean;
}

/** Null when Time Machine was never set up on this Mac, and in test and presentation modes. */
export async function timeMachineStatus(): Promise<TimeMachineStatus | null> {
  return invoke<TimeMachineStatus | null>("time_machine_status");
}

/** Open a machine's remote link (Screen Sharing, Jump Desktop). The URL is read from the database by id. */
export async function openRemoteLink(fileId: number): Promise<void> {
  await invoke("open_remote_link", { targetOrg: equipmentOrgId(), fileId });
}
