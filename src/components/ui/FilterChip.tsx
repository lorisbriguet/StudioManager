import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { CountBadge } from "./Badge";
import { useTagColor } from "./tagColor";
import { CONTROL_BOX, MUTED_INTERACTIVE } from "./tokens";

/**
 * FilterChip — a toggle pill in a filter row. See DESIGN-SYSTEM.md, "Tags".
 *
 *   <FilterChip active={filter === "active"} onClick={() => setFilter("active")}>{t.active}</FilterChip>
 *   <FilterChip active={id === f.id} count={3} onClick={…}>{f.name}</FilterChip>
 *   <FilterChip tag="typography" active={tagFilter === "typography"} onClick={…} />
 *
 * On: accent fill, or the tag's own colour when `tag` is set. Off: outlined, muted.
 * Sets aria-pressed.
 */
interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  active: boolean;
  children?: ReactNode;
  /** Small number after the label (conditions, matches). */
  count?: number;
  /** Tag filter: label defaults to the tag, and "on" uses its colour. */
  tag?: string;
  /** Shown after the label while active (e.g. an × to clear). */
  activeIcon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function FilterChip({ active, children, count, tag, activeIcon, className = "", style, type = "button", ...props }: FilterChipProps) {
  const tagColor = useTagColor(tag ?? "");
  const c = tag ? tagColor : null;
  const tone = active
    ? c
      ? "font-medium"
      : "bg-accent text-on-accent border-accent"
    : `border-[var(--color-input-border)] hover:bg-[var(--color-hover-row)] ${MUTED_INTERACTIVE}`;
  return (
    <button
      type={type}
      aria-pressed={active}
      style={active && c ? { ...style, background: c.bg, color: c.text, borderColor: c.text } : style}
      className={`inline-flex items-center gap-1 ${CONTROL_BOX} rounded-full whitespace-nowrap transition-colors focus-accent ${tone} ${className}`}
      {...props}
    >
      {children ?? tag}
      {count !== undefined && <CountBadge value={count} tone={active && !c ? "inverse" : "neutral"} />}
      {active && activeIcon}
    </button>
  );
}
