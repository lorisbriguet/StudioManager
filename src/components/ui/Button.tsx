import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "link";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Busy state: replaces the icon with a spinner and disables the button. */
  loading?: boolean;
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
  lg: "px-5 py-2.5 text-base",
};

// Link buttons are text-styled (p-0 in the variant) — size only controls text.
// Regular size padding would win over p-0 in the generated CSS, so skip it.
const linkSizeClasses: Record<ButtonSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors focus-accent ${variantClasses[variant]} ${(variant === "link" ? linkSizeClasses : sizeClasses)[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        // border-current so the spinner inherits the variant's text color
        // (an accent-colored spinner would vanish on the primary accent bg)
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 shrink-0 border-2 border-current border-t-transparent rounded-full animate-spin"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
