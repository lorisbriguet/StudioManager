import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { SURFACE } from "./tokens";

/**
 * Popover — the one floating panel of the app (see DESIGN-SYSTEM.md, "Popover").
 * Dropdown, DropdownSelect and every custom floating panel (date picker,
 * column editor, autocomplete) are built on it.
 *
 *   const pop = usePopover();
 *   <button {...pop.triggerProps}>Columns</button>
 *   {pop.open && (
 *     <Popover anchor={pop.anchorRef} onClose={pop.close} padding="content">
 *       …
 *     </Popover>
 *   )}
 *
 * - Renders on <body>, fixed to its anchor (an element, or a point for
 *   right-click), so tables, cards and modals never clip it.
 * - Opens below and flips above when there is no room; stays in the window;
 *   follows the anchor on scroll and resize.
 * - Closes on a click outside (anchor excluded) and on Esc. Esc does not
 *   reach a surrounding Modal.
 * - Clicks and keys inside it do not bubble to the anchor's React ancestors
 *   (a table row's onClick, a form's Enter handler).
 */

/** Surface shared by every floating panel. */
export const POPOVER_SURFACE = `${SURFACE} shadow-menu outline-none`;

const PADDING = {
  /** menus: rows bring their own inset */
  menu: "p-1 min-w-[160px]",
  /** forms, pickers, previews */
  content: "p-3",
  none: "",
};

/**
 * Open panels, oldest first. A panel opened from inside another one (a Select
 * in a date picker) is portalled separately, so for the outer panel a click in
 * it would look "outside". Clicks in any panel opened later are ignored.
 */
const openPanels = new Map<HTMLElement, number>();
/** Render order: a parent renders before the panels opened inside it. */
let openSeq = 0;

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface PopoverProps {
  /** Element the panel attaches to. */
  anchor?: RefObject<HTMLElement | null>;
  /** Or a point in the window (right-click menus). */
  at?: { x: number; y: number };
  /** returnFocus: true for Esc / a pick, false for a click outside. */
  onClose: (returnFocus: boolean) => void;
  align?: "start" | "end";
  /** Preferred side; flips when there is no room. */
  side?: "bottom" | "top";
  /** At least as wide as the anchor. */
  matchWidth?: boolean;
  padding?: keyof typeof PADDING;
  /**
   * Move focus into the panel on open: the element marked `data-autofocus`,
   * else the first focusable, else the panel. Turn off for an autocomplete
   * under an input, where typing must stay in the input.
   */
  autoFocus?: boolean;
  /** Runs before the built-in Esc handling; call preventDefault to keep the panel open. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  id?: string;
  /**
   * Default: "dialog" for a content panel (padding="content"), none for menus
   * (the menu inside brings its own role). A dialog needs aria-label or aria-labelledby.
   */
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Popover({
  anchor,
  at,
  onClose,
  align = "start",
  side = "bottom",
  matchWidth = false,
  padding = "menu",
  autoFocus = true,
  onKeyDown,
  id,
  role: roleProp,
  className = "",
  style,
  children,
  ...aria
}: PopoverProps) {
  const role = roleProp ?? (padding === "content" ? "dialog" : undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const unnamed = role === "dialog" && !aria["aria-label"] && !aria["aria-labelledby"];
  useEffect(() => {
    if (import.meta.env.DEV && unnamed) console.warn("Popover dialog has no accessible name: pass aria-label or aria-labelledby.");
  }, [unnamed]);
  const [seq] = useState(() => ++openSeq);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Placed straight on the element, not through state: a state update means a second render,
  // and WebKit can paint the first one (where the panel was mounted) before it.
  const placedRef = useRef(false);
  const atX = at?.x;
  const atY = at?.y;

  const place = useCallback(() => {
    const p = panelRef.current;
    if (!p) return;
    let r: { left: number; right: number; top: number; bottom: number; width: number };
    if (anchor?.current) r = anchor.current.getBoundingClientRect();
    else if (atX !== undefined && atY !== undefined) r = { left: atX, right: atX, top: atY, bottom: atY, width: 0 };
    else return;
    if (matchWidth) {
      // Never narrower than the class's own min-width (menus: 160px).
      p.style.minWidth = "";
      const base = parseFloat(getComputedStyle(p).minWidth) || 0;
      p.style.minWidth = `${Math.max(base, r.width)}px`;
    }
    const pw = p.offsetWidth;
    const ph = p.offsetHeight;
    const m = 8;
    const gap = at ? 2 : 4;
    let left = align === "end" ? r.right - pw : r.left;
    left = Math.max(m, Math.min(left, window.innerWidth - pw - m));
    const below = r.bottom + gap;
    const above = r.top - gap - ph;
    const fitsBelow = below + ph <= window.innerHeight - m;
    const fitsAbove = above >= m;
    const up = side === "top" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    let top = up ? above : below;
    top = Math.max(m, Math.min(top, window.innerHeight - ph - m));
    p.style.top = `${top}px`;
    p.style.left = `${left}px`;
    if (!placedRef.current) {
      placedRef.current = true;
      // The fade-in starts only once placed: a running animation overrides the inline opacity.
      p.style.opacity = "";
      p.style.pointerEvents = "";
      p.classList.add("animate-popover");
    }
    // `at` is read through atX/atY so a new object with the same point does not re-place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, atX, atY, align, side, matchWidth]);

  useLayoutEffect(() => {
    place();
  });

  useEffect(() => {
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    // Content that grows or shrinks after opening (a list that loads, a filter) moves the
    // flip point and the clamp: place again.
    const ro = typeof ResizeObserver !== "undefined" && panelRef.current ? new ResizeObserver(() => place()) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      ro?.disconnect();
    };
  }, [place]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const self = panelRef.current;
      if (self?.contains(t) || anchor?.current?.contains(t)) return;
      for (const [panel, n] of openPanels) if (n > seq && panel.contains(t)) return;
      onCloseRef.current(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, seq]);

  useLayoutEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    openPanels.set(p, seq);
    return () => {
      openPanels.delete(p);
    };
  }, [seq]);

  useEffect(() => {
    if (!autoFocus) return;
    const p = panelRef.current;
    if (!p) return;
    const target =
      p.querySelector<HTMLElement>("[data-autofocus]") ?? p.querySelector<HTMLElement>(FOCUSABLE) ?? p;
    target.focus({ preventScroll: true });
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      tabIndex={-1}
      onKeyDown={(e) => {
        e.stopPropagation();
        onKeyDown?.(e);
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onCloseRef.current(true);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      // `transition-none`: the position is set directly and must never glide (a bare transition
      // duration would animate `top` and `left` too, the default property being `all`).
      className={`fixed z-[60] transition-none ${POPOVER_SURFACE} ${PADDING[padding]} ${className}`}
      // Until `place` runs (before the first paint): far off screen and transparent, never at
      // the top left corner. Not visibility:hidden: a hidden element cannot take focus.
      // `place` then sets top, left, opacity and pointer events on the element itself.
      style={{ top: -9999, left: -9999, opacity: 0, pointerEvents: "none", ...style }}
    >
      {children}
    </div>,
    document.body
  );
}

/**
 * Open state + anchor for a Popover opened by a button.
 * Spread `triggerProps` on the button; `close(true)` returns focus to it.
 */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const anchorRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback((returnFocus: boolean = true) => {
    setOpen(false);
    if (returnFocus) anchorRef.current?.focus({ preventScroll: true });
  }, []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return {
    open,
    setOpen,
    toggle,
    close,
    anchorRef,
    triggerProps: {
      ref: anchorRef,
      onClick: toggle,
      "aria-expanded": open,
      "aria-haspopup": "dialog" as const,
    },
  };
}
