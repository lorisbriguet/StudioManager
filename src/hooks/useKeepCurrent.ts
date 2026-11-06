import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps `ref.current` equal to the latest `value`, for listeners, timers and effects that
 * are set up once but must call the current callback or read the current prop:
 *
 *   const onCloseRef = useRef(onClose);
 *   useKeepCurrent(onCloseRef, onClose);
 *
 * Render must not write refs, so this runs in a layout effect: the ref is current before
 * any effect or event runs. Read the ref in effects and handlers only, never during render.
 */
export function useKeepCurrent<T>(ref: RefObject<T>, value: T): void {
  useLayoutEffect(() => {
    ref.current = value;
  });
}
