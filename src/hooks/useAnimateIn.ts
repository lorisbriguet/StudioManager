import { useRef, useEffect } from "react";

/**
 * Adds the `.animate-in` class on mount for a fade+slide entrance.
 * Returns a ref to attach to the element you want animated.
 */
export function useAnimateIn<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("animate-in");
    const onEnd = () => el.classList.remove("animate-in");
    el.addEventListener("animationend", onEnd, { once: true });
    return () => el.removeEventListener("animationend", onEnd);
  }, []);

  return ref;
}
