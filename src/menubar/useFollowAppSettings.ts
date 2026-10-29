import { useEffect } from "react";
import { APPEARANCE_KEYS, syncAppearanceFromStorage } from "../stores/app-store";

/** The panel window lives for the whole session: follow theme and language changes made in the
 *  main window. `storage` fires in this window when the main window writes one of the keys;
 *  focus (the panel opening) re-reads them too, in case an event was missed. */
export function useFollowAppSettings() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || APPEARANCE_KEYS.includes(e.key)) syncAppearanceFromStorage();
    };
    const onFocus = () => syncAppearanceFromStorage();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
