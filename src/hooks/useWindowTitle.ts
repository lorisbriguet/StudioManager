import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDemoBuild } from "../lib/demoBuild";

/**
 * Keeps both document.title and the native macOS window title in sync with
 * the active organisation. document.title alone is not enough: Tauri v2
 * does not mirror it onto the native window, so the title bar (and macOS
 * Accessibility) would keep showing "StudioManager" after switching.
 */
export function useWindowTitle(orgName: string): void {
  useEffect(() => {
    const base = isDemoBuild() ? "StudioManager Demo" : "StudioManager";
    const title = orgName ? `${base} — ${orgName}` : base;
    document.title = title;
    // Cosmetic only: never let a rejected promise surface as an error.
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [orgName]);
}
