import { useEffect, useRef } from "react";
import { NEW_ITEM_EVENT, takeNewItemRequest } from "../lib/newEntity";
import { useKeepCurrent } from "./useKeepCurrent";

/**
 * Opens the page's new-item form when Cmd+N or the palette asks for it
 * (see newEntityFor in lib/newEntity.ts). `path` is the page's route.
 */
export function useNewItem(path: string, open: () => void) {
  // Keep the latest callback without re-registering the listener
  const openRef = useRef(open);
  useKeepCurrent(openRef, open);
  useEffect(() => {
    const handle = () => {
      if (takeNewItemRequest(path)) openRef.current();
    };
    handle(); // a request made before this page mounted
    window.addEventListener(NEW_ITEM_EVENT, handle);
    return () => window.removeEventListener(NEW_ITEM_EVENT, handle);
  }, [path]);
}
