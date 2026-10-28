export type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "accent" | "info" | "indigo";

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  /** xs: chips beside a form label (from receipt). */
  size?: "sm" | "xs";
  className?: string;
}

const SIZE = {
  sm: "text-xs px-2.5 py-0.5 gap-1",
  xs: "text-[10px] px-1.5 py-px gap-1",
};

export const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
  warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  danger: "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]",
  neutral: "bg-[var(--color-input-bg)] text-[var(--color-muted)]",
  accent: "bg-accent-light text-accent",
  info: "bg-[var(--color-info-bg)] text-[var(--color-info-text)]",
  indigo: "bg-[var(--color-indigo-bg)] text-[var(--color-indigo-text)]",
};

export function Badge({ variant, children, size = "sm", className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full font-medium status-transition ${SIZE[size]} ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
}

/**
 * CountBadge — a small number pill (unread, conditions, items).
 * Neutral is the neutral Badge's colours.
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
    neutral: variantClasses.neutral,
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
