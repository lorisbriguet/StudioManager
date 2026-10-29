import type { HTMLAttributes } from "react";

/**
 * Bars pinned to the top or bottom of a column of the window. Columns sit
 * side by side (app sidebar, wiki explorer, editor, side panel), so their
 * bars must share one height or the lines between them step. Heights
 * include the border (border-box).
 *
 * - BottomBar: 44px (h-11), top border. Footers and status bars.
 * - PanelTopBar: 40px (h-10), bottom border. Tab rows and toolbars at the
 *   top of a panel.
 *
 * See DESIGN-SYSTEM.md, "Window Bars".
 */
export const BOTTOM_BAR = "h-11 shrink-0 flex items-center border-t";
export const PANEL_TOP_BAR = "h-10 shrink-0 flex items-center border-b";

export function BottomBar({ className = "", ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <footer
      className={`${BOTTOM_BAR} gap-4 px-4 border-[var(--color-border)] text-xs text-muted ${className}`}
      {...rest}
    />
  );
}

/**
 * Icon-only button inside a window bar (back/forward, panel toggles, small
 * toolbar actions): the app tab bar's style. 14px icons.
 */
export const BAR_ICON_BUTTON =
  "shrink-0 p-1 rounded-md text-muted hover:text-[var(--color-text-secondary)] disabled:opacity-30 disabled:pointer-events-none transition-colors";
