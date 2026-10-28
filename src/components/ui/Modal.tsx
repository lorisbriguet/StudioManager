import { useEffect, useRef, useId, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";
import { PanelTitle } from "./PanelTitle";
import { FORM_ACTIONS, SURFACE } from "./tokens";

export type ModalSize = "sm" | "md" | "full";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** sm 400px (confirms, prompts, 1–3 fields) · md 560px (record forms, editors, palettes) · full (viewers). */
  size?: ModalSize;
  /** top: palette-style dialogs (command palette, quick timer) sit at 20% from the top. */
  position?: "center" | "top";
  /** false: the content lays itself out edge to edge (no body padding). */
  padding?: boolean;
  /** Accessible name when there is no visible title. */
  "aria-label"?: string;
}

// Every size caps at 85% of the window: the header and footer stay put and
// only the body scrolls.
const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-[400px] max-h-[85vh]",
  md: "max-w-[560px] max-h-[85vh]",
  /** viewers (receipts, PDFs): 80% × 85% of the window, content fills it */
  full: "w-[80vw]! max-w-none h-[85vh]",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, size = "sm", position = "center", padding = true, ...aria }: ModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Capture the trigger element at render time, on the closed->open transition:
  // children with autoFocus grab focus during commit (before effects run), so an
  // effect would capture the wrong element. Idempotent under StrictMode's
  // double render (wasOpenRef is already true on the second pass).
  if (open && !wasOpenRef.current) {
    const active = document.activeElement;
    previouslyFocusedRef.current = active instanceof HTMLElement ? active : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the topmost dialog closes (a confirmation opened over a form).
      // Portals mount on <body> in opening order, so the newest is last.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== ref.current) return;
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus the dialog on open (unless a child, e.g. an autoFocus input, already
  // holds focus); restore focus to the trigger on close/unmount.
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (dialog) {
      const active = document.activeElement;
      // StrictMode's simulated unmount runs the cleanup below (restoring focus
      // and clearing the saved element) without re-rendering; re-capture here so
      // the real close can still restore.
      if (
        previouslyFocusedRef.current === null &&
        active instanceof HTMLElement &&
        !dialog.contains(active)
      ) {
        previouslyFocusedRef.current = active;
      }
      if (!dialog.contains(document.activeElement)) {
        dialog.focus();
      }
    }
    return () => {
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // The trigger may have been removed while the modal was open.
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open]);

  // Trap Tab / Shift+Tab inside the dialog. Focusables are queried per keydown
  // because modal content can change while open; it is cheap at modal scale.
  const handleTrapKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const dialog = ref.current;
    if (!dialog) return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === dialog) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || active === dialog) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  // On <body>: a dialog opened inside a transformed panel (the side peek keeps
  // a transform from its enter animation) would otherwise be trapped and clipped.
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/40 animate-in fade-in ${
        position === "top" ? "items-start pt-[20vh]" : "items-center"
      }`}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : aria["aria-label"]}
        tabIndex={-1}
        className={`${SURFACE} shadow-[0_16px_48px_rgba(0,0,0,0.5)] w-full ${sizeClasses[size]} mx-4 flex flex-col overflow-hidden modal-animate outline-none`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleTrapKeyDown}
      >
        {title && (
          <PanelTitle
            as="h3"
            id={titleId}
            title={title}
            action={<IconButton icon={X} label={t.close} onClick={onClose} />}
            className="shrink-0 px-5 py-3 border-b border-[var(--color-border-divider)]"
          />
        )}
        <div className={`flex-1 min-h-0 overflow-y-auto ${padding ? "p-5" : "flex flex-col"}`}>{children}</div>
        {footer && (
          <div className={`${FORM_ACTIONS} shrink-0 px-5 py-3 border-t border-[var(--color-border-divider)]`}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
