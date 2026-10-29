import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronsUpDown } from "lucide-react";
import { ICONS, ICON_SIZE } from "../ui/icons";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { useOrgStore } from "../../stores/org-store";
import { useTimerActions } from "../../hooks/useTimerActions";
import { switchOrganisation, defaultSwitchDeps } from "../../lib/switchOrganisation";
import { notify } from "../../lib/notify";
import { useT } from "../../i18n/useT";

export function OrgSwitcher({ collapsed, onCreate }: { collapsed: boolean; onCreate: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { stopAndSave } = useTimerActions();
  const organisations = useOrgStore((s) => s.organisations);
  const activeId = useOrgStore((s) => s.activeId);
  const active = organisations.find((o) => o.id === activeId);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    setMenu({ x: r ? r.left : 16, y: r ? r.bottom + 4 : 56 });
  };

  useEffect(() => {
    const handler = () => openMenu();
    window.addEventListener("sm:open-org-switcher", handler);
    return () => window.removeEventListener("sm:open-org-switcher", handler);
  }, []);

  const doSwitch = async (id: string) => {
    if (id === activeId) return;
    try {
      const ok = await switchOrganisation(id, defaultSwitchDeps(navigate, stopAndSave));
      if (ok) {
        const name = organisations.find((o) => o.id === id)?.name ?? "";
        notify.success(t.organisation_switched.replace("{name}", name));
      }
    } catch (e) {
      notify.error(t.organisation_switch_failed, e);
    }
  };

  const items: ContextMenuItem[] = [
    ...organisations.map((o) => ({
      label: o.name,
      icon: o.id === activeId ? ICONS.selected : <span className="inline-block w-3.5" />,
      onClick: () => void doSwitch(o.id),
    })),
    { label: "", divider: true, onClick: () => {} },
    { label: t.new_organisation, icon: ICONS.add, onClick: onCreate },
    { label: t.manage_organisations, icon: ICONS.settings, onClick: () => navigate("/settings?category=organisations") },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-label={`${t.organisation}: ${active?.name ?? ""}`}
        aria-haspopup="menu"
        className={`flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${collapsed ? "justify-center" : ""}`}
      >
        <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-input-bg)] text-xs font-semibold shrink-0">
          {(active?.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left font-medium">{active?.name}</span>
            <ChevronsUpDown size={ICON_SIZE.menu} className="text-muted shrink-0" />
          </>
        )}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}
