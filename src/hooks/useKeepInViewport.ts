import { useLayoutEffect, useState, type RefObject } from "react";

const MARGIN = 8;

/**
 * Where to place a fixed popup opened at `pos` (below a caret or at the
 * pointer) so it stays inside the window: it flips above `pos.flipTop`
 * (the caret's top) when there is no room below, and slides left when it
 * would leave the right edge. Same idea as ContextMenu's own clamp, for
 * popups that keep the focus elsewhere (the editor's slash menu, the link
 * picker).
 */
export function useKeepInViewport(
  ref: RefObject<HTMLElement | null>,
  pos: { top: number; left: number; flipTop?: number },
  /** Re-measure when the popup's content changes size. */
  contentKey?: unknown
): { top: number; left: number } {
  const [placed, setPlaced] = useState({ top: pos.top, left: pos.left });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let top = pos.top;
    let left = pos.left;
    if (top + height > window.innerHeight - MARGIN) {
      const above = (pos.flipTop ?? pos.top) - height - 4;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    }
    if (left + width > window.innerWidth - MARGIN) left = Math.max(MARGIN, window.innerWidth - MARGIN - width);
    setPlaced((p) => (p.top === top && p.left === left ? p : { top, left }));
  }, [ref, pos.top, pos.left, pos.flipTop, contentKey]);

  return placed;
}
