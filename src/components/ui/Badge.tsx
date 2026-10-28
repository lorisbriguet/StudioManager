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
