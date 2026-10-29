import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { confirmIfDirty } from "../lib/dirty-guard";
import { useT } from "../i18n/useT";
import { Modal, Kbd, ICONS, ICON_SIZE, ICON_STROKE, MENU_GROUP_LABEL } from "./ui";
import { useClients } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { useInvoices } from "../db/hooks/useInvoices";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const close = useAppStore((s) => s.closeCommandPalette);
  const toggle = useAppStore((s) => s.toggleCommandPalette);
  const navigate = useNavigate();
  const t = useT();
  const [search, setSearch] = useState("");

  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: invoices } = useInvoices();

  // Cmd+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggle]);

  const go = async (path: string) => {
    // Close first so the unsaved-changes dialog isn't shown under the palette
    close();
    setSearch("");
    if (await confirmIfDirty(path)) navigate(path);
  };

  return (
    <Modal open={open} onClose={close} position="top" size="md" padding={false} aria-label={t.search_or_jump}>
      <Command
        className="overflow-hidden"
        shouldFilter={true}
      >
        <div className="flex items-center gap-2 px-4 border-b border-[var(--color-border-divider)]">
          <ICONS.search size={ICON_SIZE.callout} className="text-muted shrink-0" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={t.search_or_jump}
            className="w-full py-3 text-base outline-none bg-transparent border-none"
            autoFocus
          />
          <Kbd>Esc</Kbd>
        </div>

        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-muted">
            {t.no_results}
          </Command.Empty>

          {/* Quick actions */}
          <Command.Group heading={<GroupHeading>{t.quick_actions}</GroupHeading>}>
            <PaletteItem icon={ICONS.add} label={t.new_client} onSelect={() => go("/clients")} />
            <PaletteItem icon={ICONS.add} label={t.new_project} onSelect={() => go("/projects")} />
            <PaletteItem icon={ICONS.add} label={t.new_invoice} onSelect={() => go("/invoices/new")} />
            <PaletteItem icon={ICONS.add} label={t.new_expense} onSelect={() => go("/expenses")} />
          </Command.Group>

          {/* Navigation */}
          <Command.Group heading={<GroupHeading>{t.navigate}</GroupHeading>}>
            <PaletteItem icon={ICONS.dashboard} label={t.dashboard} onSelect={() => go("/")} />
            <PaletteItem icon={ICONS.client} label={t.clients} onSelect={() => go("/clients")} />
            <PaletteItem icon={ICONS.project} label={t.projects} onSelect={() => go("/projects")} />
            <PaletteItem icon={ICONS.task} label={t.tasks} onSelect={() => go("/tasks")} />
            <PaletteItem icon={ICONS.calendar} label={t.calendar} onSelect={() => go("/calendar")} />
            <PaletteItem icon={ICONS.invoice} label={t.invoices} onSelect={() => go("/invoices")} />
            <PaletteItem icon={ICONS.quote} label={t.quotes} onSelect={() => go("/quotes")} />
            <PaletteItem icon={ICONS.expense} label={t.expenses} onSelect={() => go("/expenses")} />
            <PaletteItem icon={ICONS.finances} label={t.finances} onSelect={() => go("/finances")} />
            <PaletteItem icon={ICONS.profile} label={t.profile} onSelect={() => go("/profile")} />
            <PaletteItem icon={ICONS.settings} label={t.settings} onSelect={() => go("/settings")} />
          </Command.Group>

          {/* Clients search */}
          {clients && clients.length > 0 && (
            <Command.Group heading={<GroupHeading>{t.clients}</GroupHeading>}>
              {clients.map((c) => (
                <PaletteItem
                  key={c.id}
                  icon={ICONS.client}
                  label={c.name}
                  subtitle={c.id}
                  onSelect={() => go(`/clients/${c.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {/* Projects search */}
          {projects && projects.length > 0 && (
            <Command.Group heading={<GroupHeading>{t.projects}</GroupHeading>}>
              {projects.map((p) => (
                <PaletteItem
                  key={p.id}
                  icon={ICONS.project}
                  label={p.name}
                  subtitle={p.status}
                  onSelect={() => go(`/projects/${p.id}`)}
                />
              ))}
            </Command.Group>
          )}

          {/* Invoices search */}
          {invoices && invoices.length > 0 && (
            <Command.Group heading={<GroupHeading>{t.invoices}</GroupHeading>}>
              {invoices.map((inv) => (
                <PaletteItem
                  key={inv.id}
                  icon={ICONS.invoice}
                  label={inv.reference}
                  subtitle={`CHF ${inv.total.toFixed(2)}`}
                  onSelect={() => go(`/invoices/${inv.id}/edit`)}
                />
              ))}
            </Command.Group>
          )}
        </Command.List>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--color-border-divider)] text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <Kbd>&uarr;&darr;</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>&crarr;</Kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd>
            close
          </span>
        </div>
      </Command>
    </Modal>
  );
}

/** A group heading: the menu group label (SECTION_LABEL), as in every other menu. */
function GroupHeading({ children }: { children: string }) {
  return <span className={`block ${MENU_GROUP_LABEL}`}>{children}</span>;
}

function PaletteItem({
  icon: Icon,
  label,
  subtitle,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  subtitle?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-[var(--color-hover-row)] data-[selected=true]:bg-[var(--color-accent-light)] data-[selected=true]:text-accent-text"
    >
      <div className="w-7 h-7 rounded-md bg-[var(--color-input-bg)] flex items-center justify-center shrink-0">
        <Icon size={ICON_SIZE.callout} strokeWidth={ICON_STROKE.nav} />
      </div>
      <span className="flex-1">{label}</span>
      {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
    </Command.Item>
  );
}
