import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { MachineFile } from "../../types/upkeep";
import { linkUrl } from "../network/model";

/** Local files open with the system (like project folders); links open in the browser, https:// assumed ("nas.local:5001" is a host and a port). */
export async function openMachineAttachment(f: Pick<MachineFile, "kind" | "path_or_url">): Promise<void> {
  if (f.kind === "file") {
    await invoke("open_in_finder", { path: f.path_or_url });
    return;
  }
  await openExternal(linkUrl(f.path_or_url));
}
