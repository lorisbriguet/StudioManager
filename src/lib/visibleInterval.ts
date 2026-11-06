/**
 * Runs `tick` every `ms` while the window is visible. Hidden, the ticks are skipped; on
 * becoming visible again it runs once right away. Returns the cleanup.
 */
export function visibleInterval(tick: () => void, ms: number): () => void {
  const visible = () => document.visibilityState === "visible";
  const id = setInterval(() => {
    if (visible()) tick();
  }, ms);
  const onChange = () => {
    if (visible()) tick();
  };
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onChange);
  };
}
