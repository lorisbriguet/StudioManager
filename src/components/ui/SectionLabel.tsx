import type { ReactNode } from "react";

/** The 10px uppercase label above a group of rows (DESIGN-SYSTEM.md, Typography).
 *  `as` makes it a heading where it names a whole panel. */
export function SectionLabel({
  children,
  className = "mb-2",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "h1" | "h2" | "h3";
}) {
  return <Tag className={`text-[10px] font-medium uppercase tracking-widest text-muted ${className}`}>{children}</Tag>;
}
