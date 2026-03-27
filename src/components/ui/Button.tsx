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
  secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-[#222] dark:text-white dark:hover:bg-[#2a2a2a] disabled:opacity-50",
  ghost: "border border-[var(--color-input-border)] text-[var(--color-muted)] hover:border-[#444] hover:text-[var(--color-text)] disabled:opacity-50",
  danger: "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-[#2a1215] dark:text-[#f87171] dark:hover:bg-[#361a1d] disabled:opacity-50",
  success: "bg-green-50 text-green-600 hover:bg-green-100 dark:bg-[#052e16] dark:text-[#4ade80] disabled:opacity-50",
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
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
