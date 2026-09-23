import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Keeps both document.title and the native macOS window title in sync with
 * the active organisation. document.title alone is not enough: Tauri v2
 * does not mirror it onto the native window, so the title bar (and macOS
 * Accessibility) would keep showing "StudioManager" after switching.
 */
export function useWindowTitle(orgName: string): void {
  useEffect(() => {
    const title = orgName ? `StudioManager — ${orgName}` : "StudioManager";
    document.title = title;
    // Cosmetic only: never let a rejected promise surface as an error.
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [orgName]);
}
