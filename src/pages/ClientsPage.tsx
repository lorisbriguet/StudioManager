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
import { Button, Badge, Card, Input, Select, FormField, PageHeader, SearchBar, TableSkeleton, EmptyState } from "../components/ui";
import * as v from "../lib/validate";
import { undoableFromStore } from "../lib/undo";
import { clientStatusVariant } from "../lib/statusColors";
import type { Client } from "../types/client";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

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
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");
  const sort: SortState<SortKey> = useMemo(
    () => ({ key: clientsSortKey as SortKey, dir: clientsSortDir }),
    [clientsSortKey, clientsSortDir]
  );
  const setSort = useCallback((s: SortState<SortKey>) => {
    setClientsSortKey(s.key);
    setClientsSortDir(s.dir);
  }, [setClientsSortKey, setClientsSortDir]);

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, [setSort]);

  const clientFields = useMemo<FilterableField[]>(() => [
    { key: "name", label: t.display_name, type: "string" },
    { key: "language", label: t.language, type: "select", options: [
      { value: "FR", label: "French" },
      { value: "EN", label: "English" },
    ]},
    { key: "status", label: "Status", type: "select", options: [
      { value: "active", label: t.active },
      { value: "inactive", label: t.inactive },
    ]},
  ], [t]);

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
    let rows = q
      ? withStatus.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q)
        )
      : withStatus;
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    return sortRows(rows, sort.key, sort.dir);
  }, [clients, search, sort, activeClientIds, filterConditions, filterLogic]);

  const bulk = useBulkSelect(filtered);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete_clients, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as string[];
    ids.forEach((id) => deleteClient.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteClient, t]);

  if (isLoading) return (
    <div>
      <PageHeader title={t.clients}>
        <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
          {t.new_client}
        </Button>
      </PageHeader>
      <TableSkeleton columns={5} />
    </div>
  );

  return (
    <div>
      <PageHeader title={t.clients}>
        <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
          {t.new_client}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }} placeholder={t.search_clients} className="mb-4 w-64" />
      <SavedFilterBar
        page="clients"
        currentFilters={{ search, sort, conditions: filterConditions, conditionLogic: filterLogic }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={clientFields}
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
            <tr className="border-b border-[var(--color-border-header)]">
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
                className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] rounded-md"
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
                <td className="px-4 py-2.5 font-medium">{c.id}</td>
                <td className="px-4 py-2.5">
                  <Link to={`/clients/${c.id}`} className="text-accent hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{c.language}</td>
                <td className="px-4 py-2.5">
                  {c.has_discount ? `${(c.discount_rate * 100).toFixed(0)}%` : "-"}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={clientStatusVariant(c.status)}>
                    {c.status === "active" ? t.active : t.inactive}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !isLoading && (
          <EmptyState
            message={(clients?.length ?? 0) === 0 ? t.no_clients : t.no_matching_clients}
            icon={<Users size={32} />}
            action={(clients?.length ?? 0) === 0 ? (
              <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
                {t.new_client}
              </Button>
            ) : undefined}
          />
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
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: async () => {
              if (!(await ask(t.confirm_delete_client, { kind: "warning" }))) return;
              deleteClient.mutate(ctxMenu.item.id, {
                onSuccess: () => undoableFromStore(t.toast_client_deleted),
              });
            } },
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

// Only fields with rules appear in the schema; the rest are unvalidated.
type ClientFormField = "name" | "email";

const clientSchema: v.FormSchema<ClientFormField> = {
  name: [v.required],
  email: [v.email],
};

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
  const [errors, setErrors] = useState<Partial<Record<ClientFormField, string>>>({});

  const setFieldError = (field: ClientFormField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });

  const validateOnBlur = (field: ClientFormField) =>
    setFieldError(field, v.validateField(form[field], clientSchema[field]));

  const clearError = (field: ClientFormField) => setFieldError(field, null);

  const submit = () => {
    const errs = v.validateForm(form, clientSchema);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    // DB failures surface via the mutation's onError toast (backstop).
    onSave({ ...form, billing_name: form.billing_name || form.name });
  };

  return (
    <Card className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t.display_name} required error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => { setForm({ ...form, name: e.target.value }); clearError("name"); }}
            onBlur={() => validateOnBlur("name")}
          />
        </FormField>
        <FormField label={t.billing_name}>
          <Input
            value={form.billing_name}
            onChange={(e) => setForm({ ...form, billing_name: e.target.value })}
          />
        </FormField>
        <FormField label={t.email} error={errors.email}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => { setForm({ ...form, email: e.target.value }); clearError("email"); }}
            onBlur={() => validateOnBlur("email")}
          />
        </FormField>
        <FormField label={t.phone}>
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </FormField>
        <FormField label={t.address_line_1}>
          <Input
            value={form.address_line1}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
          />
        </FormField>
        <FormField label={t.address_line_2}>
          <Input
            value={form.address_line2}
            onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
          />
        </FormField>
        <FormField label={t.postal_city}>
          <Input
            value={form.postal_city}
            onChange={(e) => setForm({ ...form, postal_city: e.target.value })}
          />
        </FormField>
        <FormField label={t.language}>
          <Select
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value as "FR" | "EN" })}
          >
            <option value="FR">{t.french}</option>
            <option value="EN">{t.english}</option>
          </Select>
        </FormField>
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
        <Button onClick={submit}>{t.save}</Button>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </Card>
  );
}
