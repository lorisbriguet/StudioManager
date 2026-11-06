import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { PeekHeader } from "../ui";
import { useT } from "../../i18n/useT";
import { useChanged } from "../../hooks/useChanged";

export const PEEK_MIN = 20;
export const PEEK_MAX = 70;
const PEEK_STEP = 5;
const WIDTH_KEY = "peekWidth";

const clamp = (pct: number) => Math.max(PEEK_MIN, Math.min(PEEK_MAX, pct));

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clamp(saved) : 50;
  } catch {
    return 50;
  }
}

function saveWidth(pct: number) {
  try { localStorage.setItem(WIDTH_KEY, String(Math.round(pct))); } catch { /* not persisted */ }
}

/** Escape belongs to these first: a field being edited, an open menu, dialog or popover. */
const ESC_OWNERS = 'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="dialog"]';
const OPEN_LAYERS = '[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]';

/**
 * SidePeek — a record opened beside its list (Projects, Calendar, Machines).
 * See DESIGN-SYSTEM.md, "Peek Panel".
 *
 *   {peekId !== null && (
 *     <SidePeek resizable focusKey={openCount} onClose={() => setPeekId(null)}
 *       onOpenFull={() => navigate(`/projects/${peekId}`)} returnFocus={() => cardOf(peekId)}>
 *       <ProjectDetailContent projectId={peekId} compact />
 *     </SidePeek>
 *   )}
 *
 * - Render it as the last child of the page's flex row; it slides in and out by itself.
 *   `onClose` runs once the exit animation ends: unmount it there.
 * - Escape closes it, unless a field, menu or dialog takes the key first.
 * - On open, and whenever `focusKey` changes, focus moves to the peeked page's
 *   heading (its `PageHeader as="h2"`). On close it goes back to `returnFocus()`,
 *   or to whatever had focus when the peek opened.
 * - `resizable` adds the divider: drag it, or focus it (Tab) and use Left/Right,
 *   Home/End. The width (20–70%) is remembered across launches.
 * - Keys inside the panel stay there: `useListNavigation` ignores them (`data-side-peek`).
 */
export function SidePeek({
  onClose,
  onOpenFull,
  resizable = false,
  focusKey,
  returnFocus,
  className = "",
  children,
}: {
  /** Runs when the panel has finished closing. */
  onClose: () => void;
  onOpenFull: () => void;
  resizable?: boolean;
  /** Change it to move focus into the panel again (an explicit open of another record). */
  focusKey?: unknown;
  /** Where focus goes when the panel closes. */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Extra classes for the panel (height, border). */
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [closing, setClosing] = useState(false);
  const [width, setWidth] = useState(readWidth);
  const panelRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocus);
  useLayoutEffect(() => {
    returnFocusRef.current = returnFocus;
  });

  const close = useCallback(() => setClosing(true), []);

  // Opening another record while the panel slides out keeps it open.
  if (useChanged(focusKey)) setClosing(false);

  // Focus the peeked page's heading. The content may still be loading, so wait for it.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panel.contains(active) && active !== document.body) {
      openerRef.current = active;
    }
    const focusHeading = () => {
      const heading = panel.querySelector<HTMLElement>("h1, h2");
      if (!heading) return false;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;
    panel.focus({ preventScroll: true });
    const observer = new MutationObserver(() => {
      // Stop waiting once the user has moved focus elsewhere.
      if (document.activeElement !== panel || focusHeading()) observer.disconnect();
    });
    observer.observe(panel, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [focusKey]);

  // Give focus back when the panel goes, if it was inside (or nowhere).
  useEffect(() => {
    const panel = panelRef.current;
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || (panel?.contains(active) ?? false);
      if (!lost) return;
      const target = returnFocusRef.current?.() ?? openerRef.current;
      if (target?.isConnected) {
        if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && e.target.closest(ESC_OWNERS)) return;
      if (document.querySelector(OPEN_LAYERS)) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const applyWidth = (pct: number) => {
    const next = clamp(pct);
    setWidth(next);
    saveWidth(next);
  };

  const onDividerPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const container = dividerRef.current?.parentElement;
    if (!container) return;
    const pctAt = (x: number) => {
      const rect = container.getBoundingClientRect();
      return clamp(((rect.right - x) / rect.width) * 100);
    };
    const onMove = (ev: PointerEvent) => {
      if (panelRef.current) panelRef.current.style.width = `${pctAt(ev.clientX)}%`;
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      applyWidth(pctAt(ev.clientX));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // The divider sits left of the panel: Left widens the panel, Right narrows it.
  const onDividerKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? PEEK_STEP * 2 : PEEK_STEP;
    const next =
      e.key === "ArrowLeft" ? width + step
      : e.key === "ArrowRight" ? width - step
      : e.key === "Home" ? PEEK_MIN
      : e.key === "End" ? PEEK_MAX
      : null;
    if (next === null) return;
    e.preventDefault();
    applyWidth(next);
  };

  return (
    <>
      {resizable && (
        <div
          ref={dividerRef}
          role="separator"
          aria-orientation="vertical"
          aria-label={t.resize_panel}
          aria-valuenow={Math.round(width)}
          aria-valuemin={PEEK_MIN}
          aria-valuemax={PEEK_MAX}
          tabIndex={0}
          onPointerDown={onDividerPointerDown}
          onKeyDown={onDividerKeyDown}
          className="shrink-0 w-[5px] cursor-col-resize relative group outline-none"
        >
          <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-divider)] -translate-x-1/2" />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 bg-accent-handle transition-opacity" />
        </div>
      )}
      <div
        ref={panelRef}
        data-side-peek
        role="region"
        aria-label={t.side_peek}
        tabIndex={-1}
        className={`shrink-0 min-w-0 outline-none ${resizable ? "" : "w-1/2"} ${closing ? "peek-exit overflow-hidden" : "peek-enter overflow-y-auto"} ${className}`}
        style={resizable ? { width: `${width}%` } : undefined}
        onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) onClose(); }}
      >
        <PeekHeader onClose={close} onOpenFull={onOpenFull} />
        <div className="p-4">{children}</div>
      </div>
    </>
  );
}
