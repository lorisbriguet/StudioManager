import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "link";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:opacity-85 disabled:opacity-50",
  secondary: "bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] disabled:opacity-50",
  ghost: "border border-[var(--color-input-border)] text-[var(--color-muted)] hover:border-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50",
  danger: "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] hover:opacity-80 disabled:opacity-50",
  success: "bg-[var(--color-success-bg)] text-[var(--color-success-text)] hover:opacity-80 disabled:opacity-50",
  link: "text-accent hover:underline bg-transparent p-0 disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs rounded-md",
  md: "px-4 py-[7px] text-sm",
  lg: "px-5 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors focus-accent ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
