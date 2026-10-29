import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { BrandLogo, BrandMark } from "../BrandLogo";
import { OrgSwitcher } from "./OrgSwitcher";
import { OrgCreateDialog } from "../OrgCreateDialog";
import { useAppStore } from "../../stores/app-store";
import { useTabStore } from "../../stores/tab-store";
import { confirmIfDirty } from "../../lib/dirty-guard";
import { useUnreadNotificationCount } from "../../db/hooks/useNotifications";
import { useUpkeepOverview } from "../../db/hooks/useUpkeep";
import { useTimerActions } from "../../hooks/useTimerActions";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";
import { BOTTOM_BAR, CountBadge, ICONS, IconButton, Tooltip } from "../ui";
import { navIcon, navItemClass } from "../ui/NavItem";

type NavItem = { to: string; icon: LucideIcon; labelKey: UIKey };
type SidebarItem = NavItem | { divider: true };

const navItems: SidebarItem[] = [
  { to: "/", icon: ICONS.dashboard, labelKey: "dashboard" },
  { to: "/clients", icon: ICONS.client, labelKey: "clients" },
  { to: "/projects", icon: ICONS.project, labelKey: "projects" },
  { to: "/tasks", icon: ICONS.task, labelKey: "tasks" },
  { to: "/calendar", icon: ICONS.calendar, labelKey: "calendar" },
  { divider: true },
  { to: "/wiki", icon: ICONS.wikiArticle, labelKey: "wiki" },
  { to: "/agents", icon: ICONS.agents, labelKey: "agents" },
  { to: "/resources", icon: ICONS.resource, labelKey: "resources" },
  { to: "/upkeep", icon: ICONS.upkeep, labelKey: "upkeep" },
  { divider: true },
  { to: "/invoices", icon: ICONS.invoice, labelKey: "invoices" },
  { to: "/quotes", icon: ICONS.quote, labelKey: "quotes" },
  { to: "/expenses", icon: ICONS.expense, labelKey: "expenses" },
  { to: "/income", icon: ICONS.income, labelKey: "income" },
  { to: "/finances", icon: ICONS.finances, labelKey: "finances" },
  { divider: true },
  { to: "/notifications", icon: ICONS.notifications, labelKey: "notifications" },
  { to: "/profile", icon: ICONS.profile, labelKey: "profile" },
  { to: "/settings", icon: ICONS.settings, labelKey: "settings" },
];

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const showTasksPage = useAppStore((s) => s.showTasksPage);
  const showIncome = useAppStore((s) => s.showIncome);
  const agentsEnabled = useAppStore((s) => s.agentsEnabled);
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const { overdueCount } = useUpkeepOverview();
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
      if (item.labelKey === "agents" && !agentsEnabled) return false;
      return true;
    });
  }, [showTasksPage, showIncome, agentsEnabled]);

  // Track keyboard focus index (-1 = no keyboard focus)
  const [focusIdx, setFocusIdx] = useState(-1);
  const navRef = useRef<HTMLElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
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
        // Auto-navigate immediately (like settings sub-sidebar) — but ask
        // first if the current page holds a dirty form
        const item = visibleLinks[next];
        if (item) {
          void confirmIfDirty(item.to).then((ok) => {
            if (!ok) return;
            setFocusIdx(next);
            keyNavRef.current = true;
            navigate(item.to);
          });
        }
      } else if (e.key === "ArrowRight" && focusIdx >= 0) {
        // If focused on settings/profile, enter the sub-sidebar
        const item = visibleLinks[focusIdx];
        if (item && (item.to === "/settings" || item.to === "/profile")) {
          e.preventDefault();
          void confirmIfDirty(item.to).then((ok) => {
            if (!ok) return;
            keyNavRef.current = true;
            navigate(item.to);
            setFocusIdx(-1); // Hand off to sub-sidebar
          });
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
      if (item.labelKey === "agents" && !agentsEnabled) return false;
      return true;
    });
  }, [showTasksPage, showIncome, agentsEnabled]);

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
      aria-label={t.sidebar}
      className={`flex flex-col border-r border-sidebar-border bg-sidebar h-full transition-all ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className={`flex items-center h-14 border-b border-sidebar-border ${collapsed ? "justify-center px-2" : "px-5.5"}`}>
        {collapsed ? <BrandMark className="h-3.5" /> : <BrandLogo className="h-6" />}
      </div>
      <div className="px-2 pt-2">
        <OrgSwitcher collapsed={collapsed} onCreate={() => setCreateOpen(true)} />
      </div>
      <OrgCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <nav ref={navRef} aria-label={t.main_navigation} className="flex-1 py-2 overflow-y-auto">
        {allVisible.map((item, i) => {
          if ("divider" in item) {
            return (
              <div key={`d-${i}`} className="my-2 mx-3 border-t border-[var(--color-border-divider)]" />
            );
          }
          const currentLinkIdx = linkIndexMap.get(i) ?? -1;
          const label = t[item.labelKey];
          const isNotifications = item.labelKey === "notifications";
          const isUpkeep = item.labelKey === "upkeep";
          const badgeCount = isNotifications ? unreadCount : isUpkeep ? overdueCount : 0;
          const isFocused = focusIdx === currentLinkIdx;
          // Collapsed, the link is only an icon: it takes its name from aria-label and shows it in a Tooltip.
          const collapsedName = isNotifications && unreadCount > 0 ? `${label} (${unreadCount})` : label;
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={collapsed ? collapsedName : undefined}
              data-nav-link
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  openTab(item.to, t[item.labelKey]);
                }
              }}
              className={({ isActive }) =>
                `${navItemClass({ active: isActive, size: "md", fill: false })} mx-2${isFocused ? " focus-row" : ""}`
              }
            >
              <span className="relative">
                {navIcon(item.icon)}
                {badgeCount > 0 && (
                  <CountBadge value={badgeCount} tone="danger" max={9} className="absolute -top-1.5 -right-1.5" />
                )}
              </span>
              {!collapsed && (
                <span className="flex items-center gap-2">
                  {label}
                  {badgeCount > 0 && (
                    <CountBadge value={badgeCount} tone="danger" />
                  )}
                </span>
              )}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to} content={collapsedName}>
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>
      <TimerIndicator collapsed={collapsed} />
      <div className={`${BOTTOM_BAR} border-sidebar-border px-2`}>
        <IconButton
          icon={collapsed ? ICONS.expandSidebar : ICONS.collapseSidebar}
          label={collapsed ? t.expand_sidebar : t.collapse_sidebar}
          title={`${collapsed ? t.expand_sidebar : t.collapse_sidebar} (⌘B)`}
          onClick={toggleSidebar}
          className="mx-auto"
        />
      </div>
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
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-45" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-danger)]" />
        </span>
        {!collapsed && (
          <>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-medium text-[var(--color-danger-text)] tabular-nums">{elapsed}</span>
              {activeTimer.projectName && (
                <span className="text-muted truncate">{activeTimer.projectName}</span>
              )}
            </div>
            <IconButton
              icon={ICONS.stopTimer}
              label={t.stop_timer}
              color="danger"
              onClick={() => stopAndSave()}
            />
          </>
        )}
      </div>
    </div>
  );
}
