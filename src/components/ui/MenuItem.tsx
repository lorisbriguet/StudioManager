import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { MENU_ITEM, MENU_TONE } from "./Dropdown";
import { ICON_SIZE, renderIcon, type IconProp } from "./icons";

/**
 * MenuItem — one menu row, for a Popover that holds more than a list of
 * commands (a preset list with delete buttons and a name field, a column
 * header menu). A plain list of commands is a Dropdown or a ContextMenu.
 * See DESIGN-SYSTEM.md, "Dropdown".
 *
 *   <Popover anchor={ref} onClose={close} className="w-48">
 *     <MenuItem icon={ICONS.sortAsc} selected={isAsc} onClick={…}>{t.sort_ascending}</MenuItem>
 *   </Popover>
 *
 * Same row as Dropdown and ContextMenu (MENU_ITEM): the icon is drawn at
 * 14px in a 16px slot, muted unless the row is selected or dangerous.
 */
interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A lucide component (drawn at 14px) or an element. */
  icon?: IconProp;
  /** The current choice (a sort direction, the active preset). */
  selected?: boolean;
  danger?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const HOVER = "hover:bg-[var(--color-hover-row)] focus-visible:bg-[var(--color-hover-row)]";
const DANGER_HOVER = "hover:bg-[var(--color-danger-bg)] focus-visible:bg-[var(--color-danger-bg)]";

export function MenuItem({ icon, selected = false, danger = false, children, className = "", type = "button", ...props }: MenuItemProps) {
  const tone = props.disabled
    ? MENU_TONE.disabled
    : selected
      ? MENU_TONE.selected
      : danger
        ? `${MENU_TONE.danger} ${DANGER_HOVER}`
        : `${MENU_TONE.base} ${HOVER}`;
  return (
    <button type={type} className={`${MENU_ITEM} ${tone} ${className}`} {...props}>
      {icon != null && icon !== false && (
        <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${selected || danger ? "" : "text-muted"}`}>
          {renderIcon(icon, ICON_SIZE.menu)}
        </span>
      )}
      <span className="flex-1 min-w-0 truncate">{children}</span>
    </button>
  );
}
