import { useEffect, useState } from "react";

/** Where the caller should open the row's context menu. */
export interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Arrow-key navigation over a visible list of rows (audit item 343).
 *
 * The page renders each row with `data-list-row` and highlights the row at
 * `focusIdx`. ArrowUp/Down move the focus, Enter opens the row, Space opens
 * its context menu at the row's position. Inert while the user is typing in
 * a field or a menu/dialog is open.
 */
export function useListNavigation<T>({
  items,
  onOpen,
  onMenu,
  enabled = true,
}: {
  items: T[];
  onOpen: (item: T) => void;
  onMenu: (item: T, pos: MenuPosition) => void;
  enabled?: boolean;
}) {
  const [focusIdx, setFocusIdx] = useState(-1);

  // Clamp when the list shrinks (filter, deletion, collapsed year).
  useEffect(() => {
    setFocusIdx((i) => (i >= items.length ? items.length - 1 : i));
  }, [items.length]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]'
        )
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => {
          const next =
            e.key === "ArrowDown"
              ? Math.min(i + 1, items.length - 1)
              : Math.max(i - 1, 0);
          const row = document.querySelectorAll("[data-list-row]")[next];
          row?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "Enter" && focusIdx >= 0 && items[focusIdx]) {
        e.preventDefault();
        onOpen(items[focusIdx]);
      } else if (e.key === " " && focusIdx >= 0 && items[focusIdx]) {
        e.preventDefault();
        const el = document.querySelectorAll("[data-list-row]")[focusIdx];
        const r = el?.getBoundingClientRect();
        onMenu(items[focusIdx], {
          x: r ? r.left + 32 : 80,
          y: r ? r.bottom : 80,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, focusIdx, onOpen, onMenu, enabled]);

  return { focusIdx, setFocusIdx };
}
