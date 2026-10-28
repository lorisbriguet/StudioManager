import type { ReactNode } from "react";

/** The 10px uppercase label above a group of rows (DESIGN-SYSTEM.md, Typography). */
export function SectionLabel({ children, className = "mb-2" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[10px] font-medium uppercase tracking-widest text-muted ${className}`}>{children}</div>;
}
