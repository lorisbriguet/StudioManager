/**
 * Saves that wait on a timer (the wiki autosave) are written before the app
 * quits or the window goes away. Each editor registers a flush; on quit the
 * app emits "app-will-quit", every flush runs, then "quit_ready" tells the
 * app it can exit (it exits anyway after a short wait).
 */
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type Flush = () => Promise<void> | void;

const flushes = new Set<Flush>();

/** Registers a flush; returns the function that removes it. */
export function registerFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/** Runs every registered flush; never rejects. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled(Array.from(flushes, (f) => Promise.resolve().then(f)));
}

/**
 * Flushes when the window is hidden or unloaded, and answers the app's quit
 * request once everything is written. Call once, from the main window.
 */
export function installQuitFlush(): () => void {
  const onHidden = () => {
    if (document.visibilityState === "hidden") void flushAll();
  };
  const onUnload = () => void flushAll();
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("beforeunload", onUnload);
  let unlisten: (() => void) | null = null;
  let stopped = false;
  void listen("app-will-quit", async () => {
    await flushAll();
    await invoke("quit_ready").catch(() => {});
  }).then((u) => {
    if (stopped) u();
    else unlisten = u;
  });
  return () => {
    stopped = true;
    unlisten?.();
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("beforeunload", onUnload);
  };
}
