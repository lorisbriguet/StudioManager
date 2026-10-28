import type { ReactNode } from "react";

/** Upkeep section heading (DESIGN-SYSTEM.md card/block title) with an optional action beside it. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
      {aside}
    </div>
  );
}
