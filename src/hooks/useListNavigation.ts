import { useEffect, useState } from "react";

/** Where the caller should open the row's context menu. */
export interface MenuPosition {
  x: number;
  y: number;
}

/** Keys on these belong to them (Enter/Space press a button, arrows move a radio group or a combobox). */
const OWN_KEYS =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], button, a, [role="combobox"], [role="radio"], [role="tab"], [role="switch"], [role="listbox"], [role="menuitem"], [role="option"]';

/**
 * Arrow-key navigation over a visible list of rows (audit item 343).
 *
 * The page renders each row with `data-list-row` and highlights the row at
 * `focusIdx`. ArrowUp/Down move the focus, Enter opens the row, Space opens
 * its context menu at the row's position. Inert while the user is typing in
 * a field, a menu/dialog is open, focus is on a control (a button, a link, a
 * combobox…), or another handler already took the key (defaultPrevented).
 *
 * The arrows also move DOM focus to the row (made focusable with
 * tabindex="-1"), so a screen reader reads the row it lands on.
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
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement && target.closest(OWN_KEYS)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next =
          e.key === "ArrowDown"
            ? Math.min(focusIdx + 1, items.length - 1)
            : Math.max(focusIdx - 1, 0);
        setFocusIdx(next);
        const row = document.querySelectorAll<HTMLElement>("[data-list-row]")[next];
        if (row) {
          if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
          row.focus({ preventScroll: true });
          row.scrollIntoView?.({ block: "nearest" });
        }
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
