import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip — a short hint on hover or keyboard focus. See DESIGN-SYSTEM.md, "Tooltip".
 * Replaces the native `title` attribute (slow, unstyled, no dark mode).
 *
 *   <Tooltip content={t.open_full_page}><span …>{truncatedText}</span></Tooltip>   (an icon link is IconButton `to`)
 *
 * IconButton shows its `label` this way already. No wrapper element: the
 * handlers go on the child, the bubble renders on <body>.
 */

const DELAY = 400;

export function useTooltip(content: ReactNode, { side = "top" as "top" | "bottom" } = {}) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback((el: HTMLElement, now = false) => {
    anchor.current = el;
    window.clearTimeout(timer.current);
    if (now) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), DELAY);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const r = anchor.current.getBoundingClientRect();
    const b = bubble.current;
    const m = 6;
    const left = Math.max(m, Math.min(r.left + r.width / 2 - b.offsetWidth / 2, window.innerWidth - b.offsetWidth - m));
    const above = r.top - b.offsetHeight - m;
    const below = r.bottom + m;
    const top = side === "top" ? (above >= m ? above : below) : below + b.offsetHeight > window.innerHeight - m ? above : below;
    setPos({ top, left });
  }, [open, side, content]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    const onScroll = () => hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, hide]);

  const triggerProps = {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: MouseEvent<HTMLElement>) => show(e.currentTarget),
    onMouseLeave: hide,
    onMouseDown: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      // keyboard focus only: a click also focuses, and must not pop a hint
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, true);
    },
    onBlur: hide,
  };

  const element =
    open && content
      ? createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="fixed z-[70] max-w-60 px-2 py-1 rounded-md text-xs leading-snug text-[var(--color-bg)] bg-[var(--color-text)] shadow-menu pointer-events-none animate-in fade-in duration-100"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? undefined : 0 }}
          >
            {content}
          </div>,
          document.body
        )
      : null;

  return { triggerProps, element };
}

type TriggerProps = ReturnType<typeof useTooltip>["triggerProps"];

/** Wrap one element; its own handlers still run. */
export function Tooltip({
  content,
  side,
  children,
}: {
  content: ReactNode;
  side?: "top" | "bottom";
  children: ReactElement<Partial<TriggerProps> & { "aria-label"?: string }>;
}) {
  const tip = useTooltip(content, { side });
  const own = children.props;
  // A tooltip repeating the element's name (an IconButton's label) is not a
  // description: linking it would make screen readers say it twice.
  const repeatsName = typeof content === "string" && content === own["aria-label"];
  const merged: Partial<TriggerProps> = {
    "aria-describedby": (repeatsName ? undefined : tip.triggerProps["aria-describedby"]) ?? own["aria-describedby"],
  };
  for (const key of ["onMouseEnter", "onMouseLeave", "onMouseDown", "onFocus", "onBlur"] as const) {
    const a = tip.triggerProps[key] as (e: never) => void;
    const b = own[key] as ((e: never) => void) | undefined;
    (merged as Record<string, unknown>)[key] = (e: never) => {
      a(e);
      b?.(e);
    };
  }
  return (
    <>
      {cloneElement(children, merged)}
      {tip.element}
    </>
  );
}
