import type { ReactNode } from "react";
import { HEADING_1 } from "./tokens";

/**
 * SidebarTitle — the page title at the top of a page's own sidebar
 * (Settings, Profile): the page's one h1, at level 1 (20px).
 * It sets no margin or padding: spacing belongs to the sidebar.
 *
 *   <SidebarTitle className="px-6 mb-6">{t.settings}</SidebarTitle>
 */
export function SidebarTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h1 className={`${HEADING_1} ${className}`}>{children}</h1>;
}
