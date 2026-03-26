import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function Modal({ open, onClose, title, children, size = "sm" }: ModalProps) {
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
        className={`bg-white dark:bg-gray-100 rounded-xl shadow-xl w-full ${sizeClasses[size]} mx-4 overflow-hidden animate-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-medium">{title}</h3>
            <button onClick={onClose} className="text-muted hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
        )}
        <div className={title ? "p-5" : "p-6"}>
          {children}
        </div>
      </div>
    </div>
  );
}
