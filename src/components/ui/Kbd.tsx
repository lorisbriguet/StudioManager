import type { ReactNode } from "react";

/**
 * Kbd — a keyboard key hint (⌘K, ↵, Esc). See DESIGN-SYSTEM.md, "Modal".
 *
 *   <Kbd>Esc</Kbd>   <Kbd>⌘</Kbd><Kbd>K</Kbd>
 */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded border border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-[10px] font-medium font-sans text-muted leading-none shrink-0 ${className}`}
    >
      {children}
    </kbd>
  );
}
