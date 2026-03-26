import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import {
  Users,
  FolderKanban,
  FileText,
  Receipt,
  Search,
  LayoutDashboard,
  CheckSquare,
  CalendarDays,
  BarChart3,
  Settings,
  UserCircle,
  FilePlus2,
  Plus,
} from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
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

  const go = (path: string) => {
    navigate(path);
    close();
    setSearch("");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/40" onClick={close} />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg">
        <Command
          className="bg-white dark:bg-gray-100 rounded-xl shadow-2xl border border-gray-100 overflow-hidden"
          shouldFilter={true}
        >
          <div className="flex items-center gap-2 px-4 border-b border-gray-200">
            <Search size={16} className="text-muted shrink-0" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder={t.search_or_jump}
              className="w-full py-3 text-sm outline-none bg-transparent"
              autoFocus
            />
            <kbd className="text-[10px] text-muted bg-gray-50 dark:bg-gray-200 border border-gray-200 px-1.5 py-0.5 rounded shrink-0">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted">
              {t.no_results}
            </Command.Empty>

            {/* Quick actions */}
            <Command.Group heading={t.quick_actions} className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              <PaletteItem icon={Plus} label={t.new_client} onSelect={() => go("/clients")} />
              <PaletteItem icon={Plus} label={t.new_project} onSelect={() => go("/projects")} />
              <PaletteItem icon={Plus} label={t.new_invoice} onSelect={() => go("/invoices/new")} />
              <PaletteItem icon={Plus} label={t.new_expense} onSelect={() => go("/expenses")} />
            </Command.Group>

            {/* Navigation */}
            <Command.Group heading={t.navigate} className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              <PaletteItem icon={LayoutDashboard} label={t.dashboard} onSelect={() => go("/")} />
              <PaletteItem icon={Users} label={t.clients} onSelect={() => go("/clients")} />
              <PaletteItem icon={FolderKanban} label={t.projects} onSelect={() => go("/projects")} />
              <PaletteItem icon={CheckSquare} label={t.tasks} onSelect={() => go("/tasks")} />
              <PaletteItem icon={CalendarDays} label={t.calendar} onSelect={() => go("/calendar")} />
              <PaletteItem icon={FileText} label={t.invoices} onSelect={() => go("/invoices")} />
              <PaletteItem icon={FilePlus2} label={t.quotes} onSelect={() => go("/quotes")} />
              <PaletteItem icon={Receipt} label={t.expenses} onSelect={() => go("/expenses")} />
              <PaletteItem icon={BarChart3} label={t.finances} onSelect={() => go("/finances")} />
              <PaletteItem icon={UserCircle} label={t.profile} onSelect={() => go("/profile")} />
              <PaletteItem icon={Settings} label={t.settings} onSelect={() => go("/settings")} />
            </Command.Group>

            {/* Clients search */}
            {clients && clients.length > 0 && (
              <Command.Group heading={t.clients} className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {clients.map((c) => (
                  <PaletteItem
                    key={c.id}
                    icon={Users}
                    label={c.name}
                    subtitle={c.id}
                    onSelect={() => go(`/clients/${c.id}`)}
                  />
                ))}
              </Command.Group>
            )}

            {/* Projects search */}
            {projects && projects.length > 0 && (
              <Command.Group heading={t.projects} className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {projects.map((p) => (
                  <PaletteItem
                    key={p.id}
                    icon={FolderKanban}
                    label={p.name}
                    subtitle={p.status}
                    onSelect={() => go(`/projects/${p.id}`)}
                  />
                ))}
              </Command.Group>
            )}

            {/* Invoices search */}
            {invoices && invoices.length > 0 && (
              <Command.Group heading={t.invoices} className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {invoices.map((inv) => (
                  <PaletteItem
                    key={inv.id}
                    icon={FileText}
                    label={inv.reference}
                    subtitle={`CHF ${inv.total.toFixed(2)}`}
                    onSelect={() => go(`/invoices/${inv.id}/edit`)}
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function PaletteItem({
  icon: Icon,
  label,
  subtitle,
  onSelect,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  subtitle?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer data-[selected=true]:bg-accent-light data-[selected=true]:text-accent"
    >
      <Icon size={16} strokeWidth={1.5} />
      <span className="flex-1">{label}</span>
      {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
    </Command.Item>
  );
}
