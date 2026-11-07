import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { isDemoBuild } from "./demoBuild";

// The only way the app opens something outside itself: a link in the browser, a
// file or folder in Finder. The demo build opens nothing (silently): its data is
// made up, so a link or path in it must never reach the Mac. Rust refuses too
// (`open_in_finder` and the shell plugin's `open` are off in the demo).
// A source scan (openExternal.test.ts) keeps every other file away from both.

/** Opens a URL (http(s), mailto) in the default app. Does nothing in the demo. */
export async function openExternal(url: string): Promise<void> {
  if (isDemoBuild()) return;
  await open(url);
}

/** Opens a folder in Finder, or reveals a file in its folder. Does nothing in the demo. */
export async function revealPath(path: string): Promise<void> {
  if (isDemoBuild()) return;
  await invoke("open_in_finder", { path });
}
