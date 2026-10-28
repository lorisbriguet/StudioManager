import type { ReactNode } from "react";
import { PanelTitle } from "./PanelTitle";

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
  as?: "div" | "span" | "p" | "h1" | "h2" | "h3" | "h4";
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
  return <PanelTitle as={Tag} id={id} title={children} action={action} variant="label" className={className} />;
}
