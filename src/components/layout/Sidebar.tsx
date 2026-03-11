import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare,
  CalendarDays,
  FileText,
  FilePlus2,
  Receipt,
  BarChart3,
  Bell,
  Settings,
  UserCircle,
} from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { useUnreadNotificationCount } from "../../db/hooks/useNotifications";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";

const navItems: ({ to: string; icon: typeof LayoutDashboard; labelKey: UIKey } | { divider: true })[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "dashboard" },
  { to: "/clients", icon: Users, labelKey: "clients" },
  { to: "/projects", icon: FolderKanban, labelKey: "projects" },
  { to: "/tasks", icon: CheckSquare, labelKey: "tasks" },
  { to: "/calendar", icon: CalendarDays, labelKey: "calendar" },
  { divider: true },
  { to: "/invoices", icon: FileText, labelKey: "invoices" },
  { to: "/quotes", icon: FilePlus2, labelKey: "quotes" },
  { to: "/expenses", icon: Receipt, labelKey: "expenses" },
  { to: "/finances", icon: BarChart3, labelKey: "finances" },
  { divider: true },
  { to: "/notifications", icon: Bell, labelKey: "notifications" },
  { to: "/profile", icon: UserCircle, labelKey: "profile" },
  { to: "/settings", icon: Settings, labelKey: "settings" },
];

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const showTasksPage = useAppStore((s) => s.showTasksPage);
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const t = useT();

  return (
    <aside
      className={`flex flex-col border-r border-sidebar-border bg-sidebar h-full transition-all ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex items-center h-14 px-4 border-b border-sidebar-border">
        {!collapsed && (
          <span className="font-semibold text-sm tracking-tight">
            StudioManager
          </span>
        )}
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.filter((item) => !("labelKey" in item && item.labelKey === "tasks" && !showTasksPage)).map((item, i) => {
          if ("divider" in item) {
            return (
              <div key={i} className="my-2 mx-3 border-t border-sidebar-border" />
            );
          }
          const Icon = item.icon;
          const label = t[item.labelKey];
          const isNotifications = item.labelKey === "notifications";
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 mx-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-accent-light text-accent font-medium"
                    : "text-muted hover:bg-gray-100 hover:text-gray-900"
                }`
              }
            >
              <span className="relative">
                <Icon size={18} strokeWidth={1.5} />
                {isNotifications && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[14px] h-[14px] flex items-center justify-center rounded-full leading-none">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              {!collapsed && (
                <span className="flex items-center gap-2">
                  {label}
                  {isNotifications && unreadCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none">
                      {unreadCount}
                    </span>
                  )}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
