import type { ButtonHTMLAttributes, Ref } from "react";
import { Spinner } from "./Spinner";
import { CONTROL_BOX } from "./tokens";
import { ICON_SIZE, renderIcon, type IconProp } from "./icons";

/**
 * Button — text buttons. See DESIGN-SYSTEM.md, "Button".
 *
 * One size: 26px tall, 12px text, the same height as Input, Select,
 * DatePicker and FilterChip, so every control in a row lines up. The main
 * action stands out by colour (primary), not by size.
 *
 *   <Button onClick={save}>{t.save}</Button>
 *   <Button variant="secondary" onClick={close}>{t.cancel}</Button>
 *   <Button variant="outline" icon={ICONS.download}>{t.export}</Button>
 *   <Button variant="danger" icon={ICONS.delete}>{t.delete}</Button>
 *   <Button variant="link">{t.view_all}</Button>
 *
 * Icon-only: use IconButton.
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "link";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Leading icon: a lucide component, drawn at 12px (ICON_SIZE.control). An element is kept as is. */
  icon?: IconProp;
  /** Busy state: replaces the icon with a spinner; aria-disabled and clicks ignored, focus kept. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent border-transparent hover:opacity-85",
  secondary:
    "bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--color-hover-row)]",
  outline:
    "bg-transparent border-[var(--color-input-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text)]",
  danger:
    "bg-transparent border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]",
  link: "bg-transparent border-transparent text-accent-text hover:underline",
};

// 26px, the shared control box (tokens.ts), like the fields.
const BOX = `${CONTROL_BOX} rounded-md`;
// Link buttons are text: no padding, no box.
const LINK_BOX = "p-0 text-xs leading-4 border-0";

export function Button({
  variant = "primary",
  icon,
  loading = false,
  children,
  className = "",
  disabled,
  // "button", not the browser's "submit": a Button inside a form only submits it when asked to.
  type = "button",
  onClick,
  ...props
}: ButtonProps) {
  // Loading keeps the button focusable (a disabled button drops focus to <body>):
  // aria-disabled, and clicks (also a form's Enter submit) are swallowed.
  const busy = loading && !disabled;
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap transition-colors focus-accent disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${
        variant === "link" ? LINK_BOX : BOX
      } ${variantClasses[variant]} ${className}`}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...props}
    >
      {loading ? (
        // tone="current": the spinner takes the variant's text colour
        // (an accent spinner would vanish on the primary accent bg)
        <Spinner tone="current" size={12} />
      ) : (
        renderIcon(icon, ICON_SIZE.control, { className: "shrink-0" })
      )}
      {children}
    </button>
  );
}
