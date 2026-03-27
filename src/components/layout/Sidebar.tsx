import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare,
  CalendarDays,
  FileText,
  FilePlus2,
  Receipt,
  TrendingUp,
  BarChart3,
  Bookmark,
  Clock,
  Square,
  Bell,
  Settings,
  UserCircle,
} from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { useTabStore } from "../../stores/tab-store";
import { useUnreadNotificationCount } from "../../db/hooks/useNotifications";
import { useTimerActions } from "../../hooks/useTimerActions";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";

type NavItem = { to: string; icon: typeof LayoutDashboard; labelKey: UIKey };
type SidebarItem = NavItem | { divider: true };

const navItems: SidebarItem[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "dashboard" },
  { to: "/clients", icon: Users, labelKey: "clients" },
  { to: "/projects", icon: FolderKanban, labelKey: "projects" },
  { to: "/tasks", icon: CheckSquare, labelKey: "tasks" },
  { to: "/calendar", icon: CalendarDays, labelKey: "calendar" },
  { to: "/resources", icon: Bookmark, labelKey: "resources" },
  { to: "/time-tracking", icon: Clock, labelKey: "time_tracking" },
  { divider: true },
  { to: "/invoices", icon: FileText, labelKey: "invoices" },
  { to: "/quotes", icon: FilePlus2, labelKey: "quotes" },
  { to: "/expenses", icon: Receipt, labelKey: "expenses" },
  { to: "/income", icon: TrendingUp, labelKey: "income" },
  { to: "/finances", icon: BarChart3, labelKey: "finances" },
  { divider: true },
  { to: "/notifications", icon: Bell, labelKey: "notifications" },
  { to: "/profile", icon: UserCircle, labelKey: "profile" },
  { to: "/settings", icon: Settings, labelKey: "settings" },
];

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const showTasksPage = useAppStore((s) => s.showTasksPage);
  const showIncome = useAppStore((s) => s.showIncome);
  const showTimeOverview = useAppStore((s) => s.showTimeOverview);
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const openTab = useTabStore((s) => s.openTab);
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();

  // Filter visible nav items (non-divider only for keyboard nav)
  const visibleLinks = useMemo(() => {
    return navItems.filter((item): item is NavItem => {
      if ("divider" in item) return false;
      if (item.labelKey === "tasks" && !showTasksPage) return false;
      if (item.labelKey === "income" && !showIncome) return false;
      if (item.labelKey === "time_tracking" && !showTimeOverview) return false;
      return true;
    });
  }, [showTasksPage, showIncome, showTimeOverview]);

  // Track keyboard focus index (-1 = no keyboard focus)
  const [focusIdx, setFocusIdx] = useState(-1);
  const navRef = useRef<HTMLElement>(null);
  const keyNavRef = useRef(false); // true when navigation was triggered by keyboard

  // Reset focus index when navigating via click (not keyboard)
  useEffect(() => {
    if (keyNavRef.current) {
      keyNavRef.current = false;
      return;
    }
    setFocusIdx(-1);
  }, [location.pathname]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input, textarea, or contentEditable
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;

      // Skip if modifier keys are held (except shift for potential combos)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Skip arrow keys on pages with their own sub-sidebar navigation
      // (unless sidebar has focus from ArrowLeft return)
      if (focusIdx === -1 && (location.pathname === "/settings" || location.pathname === "/profile")) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const len = visibleLinks.length;
        let next: number;
        if (focusIdx === -1) {
          const currentIdx = visibleLinks.findIndex(
            (item) => item.to === location.pathname || (item.to === "/" && location.pathname === "/")
          );
          if (e.key === "ArrowDown") {
            next = currentIdx >= 0 ? (currentIdx + 1) % len : 0;
          } else {
            next = currentIdx >= 0 ? (currentIdx - 1 + len) % len : len - 1;
          }
        } else {
          if (e.key === "ArrowDown") next = (focusIdx + 1) % len;
          else next = (focusIdx - 1 + len) % len;
        }
        setFocusIdx(next);
        // Auto-navigate immediately (like settings sub-sidebar)
        const item = visibleLinks[next];
        if (item) {
          keyNavRef.current = true;
          navigate(item.to);
        }
      } else if (e.key === "ArrowRight" && focusIdx >= 0) {
        // If focused on settings/profile, enter the sub-sidebar
        const item = visibleLinks[focusIdx];
        if (item && (item.to === "/settings" || item.to === "/profile")) {
          e.preventDefault();
          keyNavRef.current = true;
          navigate(item.to);
          setFocusIdx(-1); // Hand off to sub-sidebar
        }
      } else if (e.key === "Escape" && focusIdx >= 0) {
        setFocusIdx(-1);
      }
    },
    [visibleLinks, focusIdx, navigate, location.pathname]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Listen for sidebar-focus event from sub-sidebars (ArrowLeft)
  useEffect(() => {
    const handler = () => {
      const currentIdx = visibleLinks.findIndex(
        (item) => item.to === location.pathname
      );
      if (currentIdx >= 0) setFocusIdx(currentIdx);
    };
    window.addEventListener("sidebar-focus", handler);
    return () => window.removeEventListener("sidebar-focus", handler);
  }, [visibleLinks, location.pathname]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusIdx < 0 || !navRef.current) return;
    const links = navRef.current.querySelectorAll("[data-nav-link]");
    links[focusIdx]?.scrollIntoView({ block: "nearest" });
  }, [focusIdx]);

  // All items (including dividers) for rendering
  const allVisible = useMemo(() => {
    return navItems.filter((item) => {
      if ("divider" in item) return true;
      if (item.labelKey === "tasks" && !showTasksPage) return false;
      if (item.labelKey === "income" && !showIncome) return false;
      if (item.labelKey === "time_tracking" && !showTimeOverview) return false;
      return true;
    });
  }, [showTasksPage, showIncome, showTimeOverview]);

  // Map from allVisible index to visibleLinks index (for focus matching)
  const linkIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    let counter = 0;
    allVisible.forEach((item, i) => {
      if (!("divider" in item)) map.set(i, counter++);
    });
    return map;
  }, [allVisible]);

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
      <nav ref={navRef} className="flex-1 py-2 overflow-y-auto">
        {allVisible.map((item, i) => {
          if ("divider" in item) {
            return (
              <div key={`d-${i}`} className="my-2 mx-3 border-t border-sidebar-border" />
            );
          }
          const currentLinkIdx = linkIndexMap.get(i) ?? -1;
          const Icon = item.icon;
          const label = t[item.labelKey];
          const isNotifications = item.labelKey === "notifications";
          const isFocused = focusIdx === currentLinkIdx;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-nav-link
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  openTab(item.to, t[item.labelKey]);
                }
              }}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 mx-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-accent-light text-accent font-medium"
                    : "text-muted hover:bg-gray-100 dark:hover:bg-gray-200 hover:text-gray-900 dark:hover:text-gray-800"
                }${isFocused ? " ring-2 ring-accent/40 ring-inset" : ""}`
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
      <TimerIndicator collapsed={collapsed} />
    </aside>
  );
}

function TimerIndicator({ collapsed }: { collapsed: boolean }) {
  const { activeTimer, stopAndSave } = useTimerActions();
  const t = useT();
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!activeTimer) return;
    const tick = () => {
      const diff = Math.floor((Date.now() - activeTimer.startedAt) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  if (!activeTimer) return null;

  return (
    <div className="px-3 py-2 border-t border-sidebar-border">
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        {!collapsed && (
          <>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-medium text-red-500 tabular-nums">{elapsed}</span>
              {activeTimer.projectName && (
                <span className="text-muted truncate">{activeTimer.projectName}</span>
              )}
            </div>
            <button
              onClick={() => stopAndSave()}
              className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-200 text-red-500 hover:text-red-600"
              title={t.stop_timer}
            >
              <Square size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
