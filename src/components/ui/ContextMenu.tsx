import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MENU_DIVIDER, MENU_ITEM, MENU_TONE } from "./Dropdown";
import { Popover } from "./Popover";

/**
 * ContextMenu — the right-click menu, at the cursor. See DESIGN-SYSTEM.md, "Dropdown".
 *
 *   {menu && <ContextMenu x={menu.x} y={menu.y} items={[…]} onClose={() => setMenu(null)} />}
 *
 * Built on Popover (`at`), so it stays in the window, closes on a click
 * outside and on Esc, and Esc never closes a surrounding Modal. Focus moves
 * to the first enabled item and back to where it was on close.
 */
export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

function getEnabledItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
    (el) => !el.disabled
  );
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const capturedRef = useRef(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Capture the pre-open focused element at first render, before focus moves
  // into the menu. The component mounts fresh on each open, so first render is
  // the open transition. Idempotent under StrictMode's double render.
  if (!capturedRef.current) {
    capturedRef.current = true;
    const active = document.activeElement;
    previouslyFocusedRef.current = active instanceof HTMLElement ? active : null;
  }

  // Move focus into the menu on open; restore it on close/unmount.
  useEffect(() => {
    const menu = ref.current;
    if (menu) {
      // StrictMode's simulated unmount runs the cleanup below (restoring focus
      // and clearing the saved element) without re-rendering; re-capture here
      // so the real close can still restore.
      const active = document.activeElement;
      if (
        previouslyFocusedRef.current === null &&
        active instanceof HTMLElement &&
        !menu.contains(active)
      ) {
        previouslyFocusedRef.current = active;
      }
      const first = getEnabledItems(menu)[0];
      (first ?? menu).focus({ preventScroll: true });
    }
    return () => {
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // The pre-open element may have been removed while the menu was open.
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);

  // Restore focus to the pre-open element before running an item's action, so
  // that anything the action opens (e.g. a Modal) captures the right element
  // to return focus to — not a menu item that is about to unmount.
  const activate = (item: ContextMenuItem) => {
    if (item.disabled) return;
    const prev = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    item.onClick();
    onClose();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = ref.current;
    if (!menu) return;
    const enabled = getEnabledItems(menu);
    const currentIndex = enabled.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (enabled.length === 0) return;
        enabled[(currentIndex + 1) % enabled.length].focus({ preventScroll: true });
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (enabled.length === 0) return;
        enabled[currentIndex <= 0 ? enabled.length - 1 : currentIndex - 1].focus({
          preventScroll: true,
        });
        break;
      }
      case "Home": {
        e.preventDefault();
        enabled[0]?.focus({ preventScroll: true });
        break;
      }
      case "End": {
        e.preventDefault();
        enabled[enabled.length - 1]?.focus({ preventScroll: true });
        break;
      }
      case "Enter":
      case " ": {
        // preventDefault also suppresses the browser's native Enter/Space
        // click synthesis on buttons, so the action runs exactly once.
        e.preventDefault();
        const active = document.activeElement as HTMLElement | null;
        if (active) active.click();
        break;
      }
      case "Tab": {
        // A menu is not a tab stop; close instead of tabbing through items.
        // Focus restore happens in the unmount cleanup.
        e.preventDefault();
        onClose();
        break;
      }
      // Escape: Popover closes the menu and stops it at the menu.
    }
  };

  return (
    <Popover at={{ x, y }} onClose={onClose} onKeyDown={handleKeyDown} autoFocus={false}>
      <div ref={ref} role="menu" tabIndex={-1} className="flex flex-col outline-none">
        {items.map((item, i) => {
          if (item.divider) {
            return <div key={i} role="separator" className={MENU_DIVIDER} />;
          }
          // Same tones as Dropdown rows. Here the active row is the focused one;
          // hovering a row focuses it, as Dropdown's hover moves its active row.
          const isActive = i === focusedIndex;
          const tone = item.disabled
            ? MENU_TONE.disabled
            : item.danger
              ? isActive ? MENU_TONE.dangerActive : MENU_TONE.danger
              : isActive ? MENU_TONE.active : MENU_TONE.base;
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => activate(item)}
              onFocus={() => setFocusedIndex(i)}
              onBlur={() => setFocusedIndex((cur) => (cur === i ? null : cur))}
              onMouseMove={(e) => {
                if (!item.disabled && document.activeElement !== e.currentTarget) {
                  e.currentTarget.focus({ preventScroll: true });
                }
              }}
              disabled={item.disabled}
              className={`${MENU_ITEM} ${tone}`}
            >
              {item.icon && (
                <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${item.danger ? "" : "text-muted"}`}>
                  {item.icon}
                </span>
              )}
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/** Helper hook state for context menu positioning */
export interface ContextMenuState<T = unknown> {
  x: number;
  y: number;
  item: T;
}
