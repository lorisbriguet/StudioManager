import { useEffect, useRef, useId, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n/useT";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, size = "sm" }: ModalProps) {
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
      if (e.key === "Escape") onClose();
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`bg-[var(--color-surface)] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] w-full ${sizeClasses[size]} mx-4 overflow-hidden modal-animate outline-none`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleTrapKeyDown}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-divider)]">
            <h3 id={titleId} className="text-sm font-medium">{title}</h3>
            <button onClick={onClose} className="text-muted hover:text-[var(--color-text-secondary)]" aria-label={t.close}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className={title ? "p-5" : "p-6"}>
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border-divider)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
