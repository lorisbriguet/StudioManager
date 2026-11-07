import { invoke } from "@tauri-apps/api/core";

/** How long to wait for a frame before telling the app anyway: a hidden window may get none. */
export const SHOW_FALLBACK_MS = 50;

/**
 * The main window starts hidden and Rust leaves showing it to the page (`main_ready`), so the
 * first thing on screen is the themed page, never an empty native window in the Mac's
 * appearance. Called once the app has rendered; Rust shows the window anyway after 2 s.
 */
export function showMainWindowWhenPainted(): void {
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    invoke("main_ready").catch(() => {});
  };
  requestAnimationFrame(send);
  setTimeout(send, SHOW_FALLBACK_MS);
}
