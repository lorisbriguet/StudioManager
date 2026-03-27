import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

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

export function Modal({ open, onClose, title, children, footer, size = "sm" }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in"
      onClick={onClose}
    >
      <div
        ref={ref}
        className={`bg-[var(--color-surface)] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] w-full ${sizeClasses[size]} mx-4 overflow-hidden modal-animate`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-divider)]">
            <h3 className="text-sm font-medium">{title}</h3>
            <button onClick={onClose} className="text-muted hover:text-[var(--color-text-secondary)]">
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
