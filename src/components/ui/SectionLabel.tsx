import type { ReactNode } from "react";

/**
 * SectionLabel — the small uppercase label above a group of content
 * (year groups, settings sections, sidebar panels, stat captions).
 * See DESIGN-SYSTEM.md, "Typography".
 *
 *   <SectionLabel className="mb-2">2026</SectionLabel>
 *   <SectionLabel as="h2" action={<IconButton … />}>Backlinks</SectionLabel>
 *
 * It sets no margin: spacing belongs to the layout around it.
 */

/** The class string, for elements that can't be a component (<th>, cmdk headings). */
export const SECTION_LABEL = "text-[10px] font-medium uppercase tracking-widest text-muted";

interface SectionLabelProps {
  children: ReactNode;
  /** Use a heading tag when the label names a section (h2/h3). */
  as?: "div" | "span" | "p" | "h2" | "h3" | "h4";
  /** Right-aligned content on the same row (a count, an icon button). */
  action?: ReactNode;
  id?: string;
  className?: string;
}

export function SectionLabel({ children, as: Tag = "div", action, id, className = "" }: SectionLabelProps) {
  if (!action) {
    return (
      <Tag id={id} className={`${SECTION_LABEL} ${className}`}>
        {children}
      </Tag>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <Tag id={id} className={`${SECTION_LABEL} min-w-0 truncate`}>
        {children}
      </Tag>
      <div className="flex items-center gap-1 shrink-0">{action}</div>
    </div>
  );
}
