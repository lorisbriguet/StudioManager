import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/**
 * Button — text buttons. See DESIGN-SYSTEM.md, "Button".
 *
 * One size: 26px tall, 12px text, the same height as Input, Select,
 * DatePicker and FilterChip, so every control in a row lines up. The main
 * action stands out by colour (primary), not by size.
 *
 *   <Button onClick={save}>{t.save}</Button>
 *   <Button variant="secondary" onClick={close}>{t.cancel}</Button>
 *   <Button variant="outline" icon={<Download size={12} />}>{t.export}</Button>
 *   <Button variant="danger" icon={<Trash2 size={12} />}>{t.delete}</Button>
 *   <Button variant="link">{t.view_all}</Button>
 *
 * Icon-only: use IconButton.
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "link";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Leading icon, 12px. */
  icon?: ReactNode;
  /** Busy state: replaces the icon with a spinner and disables the button. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white border-transparent hover:opacity-85",
  secondary:
    "bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--color-hover-row)]",
  outline:
    "bg-transparent border-[var(--color-input-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text)]",
  danger:
    "bg-transparent border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]",
  link: "bg-transparent border-transparent text-accent hover:underline",
};

// 26px: py-1 (8) + 16px line + 1px border top and bottom, like the fields.
const BOX = "px-2.5 py-1 text-xs leading-4 rounded-md border";
// Link buttons are text: no padding, no box.
const LINK_BOX = "p-0 text-xs leading-4 border-0";

export function Button({
  variant = "primary",
  icon,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap transition-colors focus-accent disabled:opacity-50 disabled:cursor-not-allowed ${
        variant === "link" ? LINK_BOX : BOX
      } ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        // border-current so the spinner inherits the variant's text color
        // (an accent-colored spinner would vanish on the primary accent bg)
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 shrink-0 border-2 border-current border-t-transparent rounded-full animate-spin"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
