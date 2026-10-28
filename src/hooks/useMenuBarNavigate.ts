import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { MENUBAR_NAVIGATE } from "../lib/agents";

/** Follows the menu bar panel's "open in StudioManager" requests (`/agents?agent=…`,
 *  `/agents?new=1`) in the main window. */
export function useMenuBarNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    listen<{ path: string }>(MENUBAR_NAVIGATE, (e) => {
      if (alive) navigate(e.payload.path);
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [navigate]);
}
