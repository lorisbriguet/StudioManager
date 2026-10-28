import type { ButtonHTMLAttributes, Ref } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * IconButton — a button that is only an icon (edit, delete, close, more).
 * See DESIGN-SYSTEM.md, "Icon buttons".
 *
 *   <IconButton icon={Pencil} label={t.edit} onClick={edit} />
 *   <IconButton icon={Trash2} label={t.delete} tone="danger" reveal onClick={remove} />
 *   <IconButton icon={X} label={t.close} size="xs" onClick={onClose} />
 *
 * `label` is required: it becomes the aria-label and the hover title.
 * The icon size follows `size` (12 / 14 / 16), per the icon size table.
 * `reveal` hides the button until its row (a `group` ancestor) is hovered or
 * the button has keyboard focus.
 */

type Tone = "default" | "danger" | "accent";
type Size = "xs" | "sm" | "md";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  label: string;
  tone?: Tone;
  size?: Size;
  /** Show only on hover of the nearest `group` ancestor, or on keyboard focus. */
  reveal?: boolean;
  /** Pressed / open state (toggles, an open menu's trigger). */
  active?: boolean;
  /** Override the icon size from `size` (rare). */
  iconSize?: number;
  ref?: Ref<HTMLButtonElement>;
}

const SIZE: Record<Size, { box: string; icon: number }> = {
  xs: { box: "p-0.5 rounded", icon: 12 },
  sm: { box: "p-1 rounded-md", icon: 14 },
  md: { box: "p-1.5 rounded-md", icon: 16 },
};

const TONE: Record<Tone, string> = {
  default: "hover:text-[var(--color-text)] hover:bg-[var(--color-hover-row)]",
  danger: "hover:text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]",
  accent: "hover:text-accent hover:bg-[var(--color-hover-row)]",
};

export function IconButton({
  icon: Icon,
  label,
  tone = "default",
  size = "sm",
  reveal = false,
  active = false,
  iconSize,
  className = "",
  type = "button",
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex items-center justify-center shrink-0 transition-colors focus-accent disabled:opacity-30 disabled:pointer-events-none ${
        SIZE[size].box
      } ${active ? "text-[var(--color-text)] bg-[var(--color-hover-row)]" : "text-muted"} ${TONE[tone]} ${
        reveal ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" : ""
      } ${className}`}
      {...props}
    >
      <Icon size={iconSize ?? SIZE[size].icon} aria-hidden="true" />
    </button>
  );
}
