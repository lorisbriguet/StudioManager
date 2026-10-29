import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { MachineFile } from "../../types/upkeep";

/** Local files open with the system (like project folders); links open in the browser, https:// assumed. */
export async function openMachineAttachment(f: Pick<MachineFile, "kind" | "path_or_url">): Promise<void> {
  if (f.kind === "file") {
    await invoke("open_in_finder", { path: f.path_or_url });
    return;
  }
  const u = f.path_or_url.trim();
  await openExternal(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`);
}
