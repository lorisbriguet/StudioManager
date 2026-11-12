/** Capture commands (src-tauri/src/agents/capture.rs): the panels have no SQL, so they call these. */
import { invoke } from "@tauri-apps/api/core";

export interface CaptureProject {
  id: number;
  name: string;
  client: string;
}

/** Saves a thought in the active organisation's inbox; resolves to its id. */
export function addCapture(text: string, source: "hotkey" | "menubar", projectId: number | null): Promise<number> {
  return invoke<number>("capture_add", { text, projectId, source });
}

/** The active organisation's active projects, for the picker. */
export function captureProjects(): Promise<CaptureProject[]> {
  return invoke<CaptureProject[]>("capture_projects");
}

/** From the capture panel: hide it (after saving, or Escape). */
export function hideCapturePanel(): Promise<void> {
  return invoke<void>("capture_hide");
}

/** Sent to the capture panel's page each time Control-Option-Space shows it. */
export const CAPTURE_SHOWN = "capture:shown";

/** For Settings: null while Control-Option-Space is registered, else why it is not. */
export function captureHotkeyStatus(): Promise<string | null> {
  return invoke<string | null>("capture_hotkey_status");
}
