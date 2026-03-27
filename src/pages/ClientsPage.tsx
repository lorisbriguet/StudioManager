import { useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Eye, Trash2, ExternalLink, Users } from "lucide-react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { useClients, useCreateClient, useDeleteClient, getNextClientId } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useTabStore } from "../stores/tab-store";
import { Button, Badge, Card, Input, PageHeader, SearchBar, PageSpinner, EmptyState } from "../components/ui";
import type { Client } from "../types/client";

type SortKey = "id" | "name" | "language" | "discount_rate" | "status";

export function ClientsPage() {
  const t = useT();
  const { data: clients, isLoading } = useClients();
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Client & { status: string }> | null>(null);
  const clientsSortKey = useAppStore((s) => s.clientsSortKey);
  const clientsSortDir = useAppStore((s) => s.clientsSortDir);
  const setClientsSortKey = useAppStore((s) => s.setClientsSortKey);
  const setClientsSortDir = useAppStore((s) => s.setClientsSortDir);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const sort: SortState<SortKey> = { key: clientsSortKey as SortKey, dir: clientsSortDir };
  const setSort = useCallback((s: SortState<SortKey>) => {
    setClientsSortKey(s.key);
    setClientsSortDir(s.dir);
  }, [setClientsSortKey, setClientsSortDir]);

  const applyFilter = useCallback((filters: Record<string, unknown>) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
  }, [setSort]);

  const activeClientIds = useMemo(() => {
    if (!projects) return new Set<string>();
    return new Set(
      projects.filter((p) => p.status === "active").map((p) => p.client_id)
    );
  }, [projects]);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.toLowerCase();
    const withStatus = clients.map((c) => ({
      ...c,
      status: activeClientIds.has(c.id) ? "active" : "inactive",
    }));
    const rows = q
      ? withStatus.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q)
        )
      : withStatus;
    return sortRows(rows, sort.key, sort.dir);
  }, [clients, search, sort, activeClientIds]);

  const bulk = useBulkSelect(filtered);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as string[];
    ids.forEach((id) => deleteClient.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteClient, t]);

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      <PageHeader title={t.clients}>
        <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
          {t.new_client}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); }} placeholder={t.search_clients} className="mb-4 w-64" />
      <SavedFilterBar
        page="clients"
        currentFilters={{ search, sort }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
      />

      {showForm && (
        <NewClientForm
          onSave={async (data) => {
            const id = await getNextClientId();
            createClient.mutate(
              { ...data, id },
              {
                onSuccess: () => {
                  toast.success(t.toast_client_created);
                  setShowForm(false);
                },
              }
            );
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="w-8 px-2 py-2">
                <input type="checkbox" checked={bulk.isAllSelected} onChange={bulk.toggleAll} className="accent-[var(--accent)]" />
              </th>
              <SortHeader label="ID" sortKey="id" current={sort} onSort={setSort} />
              <SortHeader label={t.display_name} sortKey="name" current={sort} onSort={setSort} />
              <SortHeader label={t.language} sortKey="language" current={sort} onSort={setSort} />
              <SortHeader label={t.cultural_discount} sortKey="discount_rate" current={sort} onSort={setSort} />
              <SortHeader label="Status" sortKey="status" current={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-200"
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: c }); }}
              >
                <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={bulk.selected.has(c.id)}
                    onChange={(e) => bulk.toggleItem(c.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                    className="accent-[var(--accent)]"
                  />
                </td>
                <td className="px-4 py-2 text-muted">{c.id}</td>
                <td className="px-4 py-2">
                  <Link to={`/clients/${c.id}`} className="text-accent hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.language}</td>
                <td className="px-4 py-2">
                  {c.has_discount ? `${(c.discount_rate * 100).toFixed(0)}%` : "-"}
                </td>
                <td className="px-4 py-2">
                  <Badge variant={c.status === "active" ? "success" : "neutral"}>
                    {c.status === "active" ? t.active : t.inactive}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !isLoading && (
          <EmptyState message={t.no_clients ?? "No clients found"} icon={<Users size={32} />} />
        )}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.view_details, icon: <Eye size={14} />, onClick: () => navigate(`/clients/${ctxMenu.item.id}`) },
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/clients/${ctxMenu.item.id}`, ctxMenu.item.name) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteClient.mutate(ctxMenu.item.id) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

function NewClientForm({
  onSave,
  onCancel,
}: {
  onSave: (data: Omit<Client, "id" | "created_at" | "updated_at">) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    name: "",
    billing_name: "",
    address_line1: "",
    address_line2: "",
    postal_city: "",
    email: "",
    phone: "",
    language: "FR" as "FR" | "EN",
    has_discount: 0,
    discount_rate: 0.1,
    notes: "",
  });

  return (
    <Card className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          placeholder={`${t.display_name} *`}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          placeholder={t.billing_name}
          value={form.billing_name}
          onChange={(e) => setForm({ ...form, billing_name: e.target.value })}
        />
        <Input
          placeholder={t.address_line_1}
          value={form.address_line1}
          onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
        />
        <Input
          placeholder={t.address_line_2}
          value={form.address_line2}
          onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
        />
        <Input
          placeholder={t.postal_city}
          value={form.postal_city}
          onChange={(e) => setForm({ ...form, postal_city: e.target.value })}
        />
        <select
          value={form.language}
          onChange={(e) => setForm({ ...form, language: e.target.value as "FR" | "EN" })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm dark:border-gray-600"
        >
          <option value="FR">French</option>
          <option value="EN">English</option>
        </select>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form.has_discount}
            onChange={(e) => setForm({ ...form, has_discount: e.target.checked ? 1 : 0 })}
          />
          {t.cultural_discount}
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (!form.name.trim()) return toast.error(t.toast_name_required);
            onSave({ ...form, billing_name: form.billing_name || form.name });
          }}
        >
          {t.save}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </Card>
  );
}
