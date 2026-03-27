export type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "accent" | "info" | "indigo";

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-green-100 text-green-700 dark:bg-[#052e16] dark:text-[#4ade80]",
  warning: "bg-yellow-100 text-yellow-700 dark:bg-[#1c1917] dark:text-[#fbbf24]",
  danger: "bg-red-100 text-red-700 dark:bg-[#2a1215] dark:text-[#f87171]",
  neutral: "bg-[var(--color-input-bg)] text-[var(--color-muted)]",
  accent: "bg-accent-light text-accent",
  info: "bg-blue-100 text-blue-700 dark:bg-[#0c1a2e] dark:text-[#38bdf8]",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-[#1a1a2e] dark:text-[#818cf8]",
};

export function Badge({ variant, children, className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-medium status-transition ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
}
