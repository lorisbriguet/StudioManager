import type { MouseEvent, ReactNode } from "react";

interface IconButtonProps {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** For a button that opens a menu. */
  hasMenu?: boolean;
  children: ReactNode;
}

/** A small icon-only button (row actions, "..." menus); the label is its accessible name. */
export function IconButton({ label, onClick, disabled, hasMenu, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup={hasMenu ? "menu" : undefined}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded-md text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-hover-row)] disabled:opacity-30 disabled:cursor-not-allowed focus-accent"
    >
      {children}
    </button>
  );
}
