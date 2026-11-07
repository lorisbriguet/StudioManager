import { invoke } from "@tauri-apps/api/core";

/** How long to wait for frames before telling the app anyway: a hidden window may get none. */
export const SHOW_FALLBACK_MS = 50;

/** The chosen theme, as Rust needs it to colour the native window before showing it. */
export function windowTheme(): { dark: boolean; background: string | null } {
  const root = document.documentElement;
  const background = getComputedStyle(root).getPropertyValue("--color-bg").trim();
  return { dark: root.classList.contains("dark"), background: background || null };
}

/**
 * The main window starts hidden and Rust leaves showing it to the page (`main_ready`), so the
 * first thing on screen is the themed page, never an empty native window in the Mac's
 * appearance. Rust gives the window the theme's appearance and background before showing it,
 * which covers the moment the web view has not drawn yet. Called once the app has rendered,
 * after two frames; Rust shows the window anyway after 2 s.
 */
export function showMainWindowWhenPainted(): void {
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    invoke("main_ready", windowTheme()).catch(() => {});
  };
  requestAnimationFrame(() => requestAnimationFrame(send));
  setTimeout(send, SHOW_FALLBACK_MS);
}
