import type { ButtonHTMLAttributes, Ref } from "react";
import { Tooltip } from "./Tooltip";
import type { LucideIcon } from "lucide-react";

/**
 * IconButton — a button that is only an icon (edit, delete, close, more).
 * See DESIGN-SYSTEM.md, "Icon buttons".
 *
 *   <IconButton icon={Pencil} label={t.edit} onClick={edit} />                     sm: 26px, icon 14
 *   <IconButton icon={Trash2} label={t.delete} size="xs" tone="danger" reveal />  xs: 20px, icon 12 (rows)
 *   <IconButton icon={X} label={t.remove} size="xs" reveal="task" />             named group: group/task
 *   <IconButton icon={ChevronRight} label={t.expand} size="xs"
 *     iconClassName={`transition-transform ${open ? "rotate-90" : ""}`} />
 *
 * Two sizes, each a fixed square with a fixed icon, so padding is never set
 * by hand: sm = 26px box (the height of every control) around a 14px icon;
 * xs = 20px box around a 12px icon, for table rows and lists.
 * `label` is required: it becomes the aria-label and the hover Tooltip
 * (pass `title` to show a different hint).
 * `reveal` hides the button until its row is hovered (the nearest `group`,
 * or a named one: reveal="task" → group/task) or it has keyboard focus.
 */

type Tone = "default" | "danger" | "accent";
type Size = "xs" | "sm";
/** Named hover groups used by rows in the app (group/task, group/row…). */
export type RevealGroup = true | "row" | "task" | "sub" | "item" | "col";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  label: string;
  tone?: Tone;
  size?: Size;
  /** Show only on hover of the row: `true` = nearest `group`, or a named group ("task" → group/task). */
  reveal?: RevealGroup | false;
  /** Pressed / open state (toggles, an open menu's trigger). */
  active?: boolean;
  /** Coloured at rest, not only on hover: a running timer (danger), a confirm check (accent). */
  color?: "danger" | "accent";
  /** Classes on the icon itself, e.g. a rotating expand chevron. */
  iconClassName?: string;
  ref?: Ref<HTMLButtonElement>;
}

const SIZE: Record<Size, { box: string; icon: number }> = {
  sm: { box: "w-6.5 h-6.5 rounded-md", icon: 14 },
  xs: { box: "w-5 h-5 rounded", icon: 12 },
};

// Spelled out so Tailwind generates each one.
export const REVEAL_CLASSES: Record<"group" | Exclude<RevealGroup, true>, string> = {
  group: "opacity-0 group-hover:opacity-100",
  row: "opacity-0 group-hover/row:opacity-100",
  task: "opacity-0 group-hover/task:opacity-100",
  sub: "opacity-0 group-hover/sub:opacity-100",
  item: "opacity-0 group-hover/item:opacity-100",
  col: "opacity-0 group-hover/col:opacity-100",
};

/**
 * Hidden until its row is hovered (`true` = nearest `group`, or a named group)
 * or it has keyboard focus. Shared with DragHandle. A falsy value gives "".
 */
export function revealClass(reveal: RevealGroup | false | undefined): string {
  if (!reveal) return "";
  return `${REVEAL_CLASSES[reveal === true ? "group" : reveal]} focus-visible:opacity-100`;
}

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
  color,
  iconClassName,
  className = "",
  type = "button",
  title,
  ...props
}: IconButtonProps) {
  // Tooltip adds its hover/focus handlers and aria-describedby, and still runs the caller's.
  return (
    <Tooltip content={title ?? label}>
    <button
      type={type}
      aria-label={label}
      className={`inline-flex items-center justify-center shrink-0 transition-colors focus-accent disabled:opacity-30 disabled:pointer-events-none ${
        SIZE[size].box
      } ${
        active
          ? "text-[var(--color-text)] bg-[var(--color-hover-row)]"
          : color === "danger"
            ? "text-[var(--color-danger-text)]"
            : color === "accent"
              ? "text-accent"
              : "text-muted"
      } ${TONE[color ?? tone]} ${
        reveal ? `${revealClass(reveal)} aria-expanded:opacity-100` : ""
      } ${className}`}
      {...props}
    >
      <Icon size={SIZE[size].icon} className={iconClassName} aria-hidden="true" />
    </button>
    </Tooltip>
  );
}
