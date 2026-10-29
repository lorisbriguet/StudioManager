import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { MUTED_INTERACTIVE } from "./tokens";
import { ICON_SIZE, ICON_STROKE, renderIcon, type IconProp } from "./icons";

/**
 * NavItem — a row in a navigation list (app sidebar, settings and profile
 * categories, wiki explorer, custom lists). See DESIGN-SYSTEM.md, "Navigation".
 *
 *   <NavItem active={cat === "general"} icon={ICONS.settings} onClick={…}>{t.general}</NavItem>
 *
 * A component icon is drawn at 14px (ICON_SIZE.menu); `navIcon(icon)` gives
 * the app sidebar's 18px / stroke 1.5 for a NavLink row.
 *
 * For a router link or a row that holds other controls, use the class string:
 *   <NavLink className={({ isActive }) => navItemClass({ active: isActive, size: "md" })} />
 */

type Size = "sm" | "md";

const SIZE: Record<Size, string> = {
  /** in-page lists: settings, wiki explorer, custom lists */
  sm: "gap-2 px-3 py-1.5 text-xs",
  /** main navigation: app sidebar, profile */
  md: "gap-2.5 px-3.5 py-1.5 text-sm",
};

export function navItemClass({
  active,
  size = "sm",
  fill = true,
}: {
  active: boolean;
  size?: Size;
  /** Full width. Off for a row with side margins (the app sidebar's mx-2). */
  fill?: boolean;
}) {
  return `${fill ? "w-full " : ""}flex items-center rounded-md text-left transition-colors focus-accent ${SIZE[size]} ${
    active
      ? "bg-accent-light text-accent font-medium"
      : `hover:bg-[var(--color-hover-row)] ${MUTED_INTERACTIVE}`
  }`;
}

/** The app sidebar's icon: 18px, stroke 1.5. */
export function navIcon(icon: IconProp) {
  return renderIcon(icon, ICON_SIZE.nav, { strokeWidth: ICON_STROKE.nav, className: "shrink-0" });
}

interface NavItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  active: boolean;
  /** A lucide component (drawn at 14px) or an element. */
  icon?: IconProp;
  size?: Size;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function NavItem({ active, icon, size = "sm", children, className = "", type = "button", ...props }: NavItemProps) {
  return (
    <button
      type={type}
      aria-current={active ? "page" : undefined}
      className={`${navItemClass({ active, size })} ${className}`}
      {...props}
    >
      {icon != null && icon !== false && <span className="shrink-0 flex items-center">{renderIcon(icon, ICON_SIZE.menu)}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}
