import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { getTagColor } from "../../lib/tagColors";
import { useAppStore } from "../../stores/app-store";

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
  const dark = useAppStore((s) => s.darkMode);
  const c = tag ? getTagColor(tag, dark) : null;
  const tone = active
    ? c
      ? "font-medium"
      : "bg-accent text-white border-accent"
    : "border-[var(--color-input-border)] text-muted hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text-secondary)]";
  return (
    <button
      type={type}
      aria-pressed={active}
      style={active && c ? { ...style, background: c.bg, color: c.text, borderColor: c.text } : style}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border whitespace-nowrap transition-colors focus-accent ${tone} ${className}`}
      {...props}
    >
      {children ?? tag}
      {count !== undefined && <CountBadge value={count} tone={active && !c ? "inverse" : "neutral"} />}
      {active && activeIcon}
    </button>
  );
}

/**
 * CountBadge — a small number pill (unread, conditions, items).
 *
 *   <CountBadge value={3} />   <CountBadge value={2} tone="danger" />
 */
export function CountBadge({
  value,
  tone = "neutral",
  max = 99,
  className = "",
}: {
  value: number;
  tone?: "neutral" | "danger" | "accent" | "inverse";
  max?: number;
  className?: string;
}) {
  const toneCls = {
    neutral: "bg-[var(--color-input-bg)] text-muted",
    danger: "bg-[var(--color-danger-text)] text-white",
    accent: "bg-accent text-white",
    inverse: "bg-white/25 text-current",
  }[tone];
  return (
    <span
      className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-medium leading-none tabular-nums ${toneCls} ${className}`}
    >
      {value > max ? `${max}+` : value}
    </span>
  );
}
