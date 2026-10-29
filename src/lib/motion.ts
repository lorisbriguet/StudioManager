/**
 * True when motion should be cut: the OS asks for reduced motion, or the app's
 * own "Reduce motion" setting is on (the `reduce-motion` class on <html>).
 * CSS covers animations and transitions (index.css); this is for motion
 * started from script, such as smooth scrolling.
 */
export function prefersReducedMotion(): boolean {
  if (document.documentElement.classList.contains("reduce-motion")) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** "smooth", or "auto" (a jump) when motion is reduced. */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");
