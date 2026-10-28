import type { ReactNode } from "react";
import { X, Pin } from "lucide-react";
import { IconButton } from "./IconButton";
import { MUTED_INTERACTIVE } from "./tokens";

/**
 * One tab, as in the app's tab bar: an accent underline on the active tab,
 * a close button on hover. Used by every tab row in the app so they all
 * look the same. A non-interactive container holds two sibling buttons
 * (activate, close): a button inside a button is invalid.
 */
type TabItemProps = {
  label: string;
  active: boolean;
  onActivate: () => void;
  pinned?: boolean;
  icon?: ReactNode;
  /** "tab" inside a role="tablist"; the app's page tabs are links to pages. */
  role?: "tab";
} & (
  /** Omit both for tabs that can't be closed. */
  | { onClose?: undefined; closeLabel?: undefined }
  /** Closable (middle-click closes too); the close button needs a name. */
  | { onClose: () => void; closeLabel: string }
);

export function TabItem({ label, active, onActivate, onClose, closeLabel, pinned = false, icon, role }: TabItemProps) {
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
          : `border-transparent ${MUTED_INTERACTIVE}`
      }`}
    >
      <button
        type="button"
        onClick={onActivate}
        role={role}
        aria-selected={role === "tab" ? active : undefined}
        aria-current={role === "tab" ? undefined : active ? "page" : undefined}
        className="flex items-center gap-1.5 cursor-pointer min-w-0 rounded focus-accent"
      >
        {pinned && <Pin size={10} className="text-muted shrink-0" />}
        {icon}
        <span className="max-w-[160px] truncate">{label}</span>
      </button>
      {onClose && !pinned && (
        <IconButton
          icon={X}
          label={closeLabel}
          size="xs"
          tone="danger"
          reveal
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-0.5"
        />
      )}
    </div>
  );
}
