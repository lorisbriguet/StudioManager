import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

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

  // Capture the pre-open focused element at first render, before focus moves
  // into the menu. The component mounts fresh on each open, so first render is
  // the open transition. Idempotent under StrictMode's double render.
  if (!capturedRef.current) {
    capturedRef.current = true;
    const active = document.activeElement;
    previouslyFocusedRef.current = active instanceof HTMLElement ? active : null;
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  // Keep menu within viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const el = ref.current;
    if (rect.right > window.innerWidth) {
      el.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  // Move focus into the menu on open; restore it on close/unmount.
  // preventScroll: the menu is positioned at the cursor, focusing it must not
  // scroll the page.
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
      // Escape is handled by the document-level listener above.
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[160px] animate-in fade-in duration-100 outline-none"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return (
            <div
              key={i}
              role="separator"
              className="my-1 border-t border-[var(--color-border-divider)]"
            />
          );
        }
        return (
          <button
            key={i}
            role="menuitem"
            tabIndex={-1}
            onClick={() => activate(item)}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors outline-none ${
              item.disabled
                ? "text-muted opacity-50 cursor-not-allowed"
                : item.danger
                  ? "text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] focus-visible:bg-[var(--color-danger-bg)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] focus-visible:bg-[var(--color-hover-row)]"
            }`}
          >
            {item.icon && <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Helper hook state for context menu positioning */
export interface ContextMenuState<T = unknown> {
  x: number;
  y: number;
  item: T;
}
