import type { ReactNode } from "react";
import { X, Pin } from "lucide-react";

/**
 * One tab, as in the app's tab bar: an accent underline on the active tab,
 * a close button on hover. Used by every tab row in the app so they all
 * look the same. A non-interactive container holds two sibling buttons
 * (activate, close): a button inside a button is invalid.
 */
export function TabItem({
  label,
  active,
  onActivate,
  onClose,
  closeLabel,
  pinned = false,
  icon,
  role,
}: {
  label: string;
  active: boolean;
  onActivate: () => void;
  /** Omit for tabs that can't be closed. Middle-click closes too. */
  onClose?: () => void;
  closeLabel?: string;
  pinned?: boolean;
  icon?: ReactNode;
  /** "tab" inside a role="tablist"; the app's page tabs are links to pages. */
  role?: "tab";
}) {
  return (
    <div
      onAuxClick={(e) => {
        if (e.button === 1 && onClose) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm shrink-0 border-b-2 transition-colors group select-none ${
        active
          ? "border-accent text-[var(--color-text)] font-medium"
          : "border-transparent text-muted hover:text-[var(--color-text-secondary)]"
      }`}
    >
      <button
        type="button"
        onClick={onActivate}
        role={role}
        aria-selected={role === "tab" ? active : undefined}
        aria-current={role === "tab" ? undefined : active ? "page" : undefined}
        className="flex items-center gap-1.5 cursor-pointer min-w-0"
      >
        {pinned && <Pin size={10} className="text-muted shrink-0" />}
        {icon}
        <span className="max-w-[160px] truncate">{label}</span>
      </button>
      {onClose && !pinned && (
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-danger-text)] shrink-0 ml-0.5"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
