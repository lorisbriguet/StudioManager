import type { ReactNode } from "react";
import { SECTION_LABEL } from "./SectionLabel";
import { HEADING_2, HEADING_COUNT } from "./tokens";

/**
 * PanelTitle — a panel's title row: the title on the left, an optional action
 * on the right (close button, "Add line", "View all"). See DESIGN-SYSTEM.md.
 *
 *   <PanelTitle title={t.line_items} action={<Button variant="link" …>{t.add_line}</Button>} />
 *   <PanelTitle title={t.stale_tasks} tone="warning" className="mb-3" />
 *
 * Used by Modal's header, dashboard WidgetTitle, LineItemsTable and
 * SectionLabel (variant="label": the small uppercase label). It sets no margin
 * or padding: spacing belongs to the layout around it (`className`).
 */

const TONE = {
  default: "",
  danger: "text-[var(--color-danger-text)]",
  warning: "text-[var(--color-warning-text)]",
};

/**
 * title: level 2, 14px semibold (modal, widget, card and section titles).
 * label: the uppercase SectionLabel, truncated to leave room for the action.
 * Read at render time: SectionLabel imports this file, so SECTION_LABEL is
 * not yet defined when this module first evaluates.
 */
const variantClass = (variant: "title" | "label") =>
  variant === "label" ? `${SECTION_LABEL} truncate` : HEADING_2;

export interface PanelTitleProps {
  title: ReactNode;
  /** A count after the title, muted ("Projects 3"). Never bake it into the title string. */
  count?: ReactNode;
  /** Right-aligned content on the same row. */
  action?: ReactNode;
  as?: "div" | "span" | "p" | "h1" | "h2" | "h3" | "h4";
  tone?: keyof typeof TONE;
  variant?: "title" | "label";
  /** Id of the title element (for aria-labelledby). */
  id?: string;
  /** Classes on the row. */
  className?: string;
}

export function PanelTitle({
  title,
  count,
  action,
  as: Tag = "h2",
  tone = "default",
  variant = "title",
  id,
  className = "",
}: PanelTitleProps) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <Tag id={id} className={`min-w-0 ${variantClass(variant)} ${TONE[tone]}`}>
        {title}
        {count != null && count !== false && <span className={HEADING_COUNT}>{count}</span>}
      </Tag>
      {action != null && action !== false && <div className="flex items-center gap-1 shrink-0">{action}</div>}
    </div>
  );
}
