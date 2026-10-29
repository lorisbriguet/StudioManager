import { useState, useMemo, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Eye, Trash2, ExternalLink, Users } from "lucide-react";
import { notify } from "../lib/notify";
import { useClients, useCreateClient, useDeleteClient, getNextClientId } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { SortHeader, sortRows, type SortState } from "../components/ui/SortHeader";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useTabStore } from "../stores/tab-store";
import { useListNavigation } from "../hooks/useListNavigation";
import { Checkbox, Button, Badge, Input, Select, FormField, FormGrid, FormGridItem, FormModal, PageHeader, SearchBar, Table, TableSkeleton, EmptyState, QueryState, NoResults } from "../components/ui";
import * as v from "../lib/validate";
import { deleteWithUndo } from "../lib/undo";
import { confirmDelete } from "../lib/confirm";
import { useBulkDelete } from "../hooks/useBulkDelete";
import { clientStatusVariant } from "../lib/statusColors";
import type { Client } from "../types/client";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

type SortKey = "id" | "name" | "language" | "discount_rate" | "status";

export function ClientsPage() {
  const t = useT();
  const clientsQuery = useClients();
  const { data: clients } = clientsQuery;
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();
  // Synchronous guard for the quick-create form: `onSave` awaits
  // getNextClientId() before calling createClient.mutate(), so isPending
  // stays false for that whole await — a second click/Enter in that window
  // isn't caught by the `disabled={createClient.isPending}` prop below. This
  // ref is set synchronously at the top of onSave (before any await), so a
  // second call in the same window returns immediately.
  const creatingClientRef = useRef(false);
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

  // Keyboard row navigation (flat list — every filtered row is visible).
  const openClient = useCallback((c: (typeof filtered)[0]) => navigate(`/clients/${c.id}`), [navigate]);
  const { focusIdx } = useListNavigation({
    items: filtered,
    onOpen: openClient,
    onMenu: useCallback((c: (typeof filtered)[0], pos: { x: number; y: number }) => setCtxMenu({ ...pos, item: c }), []),
  });

  const bulk = useBulkSelect(filtered);

  // Cascading: a client takes its projects, tasks and documents with it, so
  // both deletes ask first (then Undo brings everything back).
  const deleteSelection = useBulkDelete("clients", (id: string) => deleteClient.mutateAsync(id), {
    message: t.delete_clients_cascade,
  });
  const bulkDelete = () => void deleteSelection([...bulk.selected] as string[], bulk.clearSelection);

  const clearFilters = () => {
    setSearch("");
    setFilterConditions([]);
    setActiveFilterId(null);
  };

  return (
    <div>
      <PageHeader title={t.clients}>
        <Button icon={<Plus size={12} />} onClick={() => setShowForm(true)}>
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
          saving={createClient.isPending}
          onSave={async (data) => {
            if (creatingClientRef.current) return;
            creatingClientRef.current = true;
            try {
              const id = await getNextClientId();
              createClient.mutate(
                { ...data, id },
                {
                  onSuccess: () => {
                    notify.success(t.toast_client_created);
                    setShowForm(false);
                  },
                  onSettled: () => {
                    creatingClientRef.current = false;
                  },
                }
              );
            } catch {
              creatingClientRef.current = false;
            }
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <QueryState query={clientsQuery} skeleton={<TableSkeleton columns={6} />} errorMessage={t.load_error_clients}>
      {(all) => (
      <Table>
        <Table.Head>
          <Table.SelectAll all={bulk.isAllSelected} some={bulk.selected.size > 0} onToggle={bulk.toggleAll} />
          <SortHeader label="ID" sortKey="id" current={sort} onSort={setSort} />
          <SortHeader label={t.display_name} sortKey="name" current={sort} onSort={setSort} />
          <SortHeader label={t.language} sortKey="language" current={sort} onSort={setSort} />
          <SortHeader label={t.cultural_discount} sortKey="discount_rate" current={sort} onSort={setSort} align="right" />
          <SortHeader label="Status" sortKey="status" current={sort} onSort={setSort} />
        </Table.Head>
        <Table.Body>
          {filtered.map((c, ci) => (
            <Table.Row
              key={c.id}
              data-list-row
              focused={ci === focusIdx}
              selected={bulk.selected.has(c.id)}
              onOpen={() => openClient(c)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: c }); }}
            >
              <Table.Select checked={bulk.selected.has(c.id)} onToggle={(shift) => bulk.toggleItem(c.id, shift)} />
              <Table.Td className="font-medium">{c.id}</Table.Td>
              <Table.Td>
                <Link to={`/clients/${c.id}`} className="text-accent hover:underline">
                  {c.name}
                </Link>
              </Table.Td>
              <Table.Td>{c.language}</Table.Td>
              <Table.Td numeric>
                {c.has_discount ? `${(c.discount_rate * 100).toFixed(0)}%` : "-"}
              </Table.Td>
              <Table.Td>
                <Badge variant={clientStatusVariant(c.status)}>
                  {c.status === "active" ? t.active : t.inactive}
                </Badge>
              </Table.Td>
            </Table.Row>
          ))}
          {filtered.length === 0 && (
            <Table.Empty colSpan={6}>
              {all.length === 0 ? (
                <EmptyState
                  message={t.no_clients}
                  icon={Users}
                  action={
                    <Button icon={<Plus size={12} />} onClick={() => setShowForm(true)}>
                      {t.new_client}
                    </Button>
                  }
                />
              ) : (
                <NoResults message={t.no_matching_clients} onClear={clearFilters} />
              )}
            </Table.Empty>
          )}
        </Table.Body>
      </Table>
      )}
      </QueryState>
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
              const client = ctxMenu.item;
              if (!(await confirmDelete(client.name, t.delete_client_cascade))) return;
              deleteWithUndo(deleteClient, client.id, t.toast_client_deleted);
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
  saving,
}: {
  onSave: (data: Omit<Client, "id" | "created_at" | "updated_at">) => void;
  onCancel: () => void;
  saving: boolean;
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
    <FormModal open onClose={onCancel} title={t.new_client} submitLabel={t.save} onSubmit={submit} submitting={saving}>
      <FormGrid cols={2}>
        <FormField label={t.display_name} required error={errors.name}>
          <Input
            autoFocus
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
        <FormGridItem>
          <Checkbox
            label={t.cultural_discount}
            checked={!!form.has_discount}
            onChange={(e) => setForm({ ...form, has_discount: e.target.checked ? 1 : 0 })}
          />
        </FormGridItem>
      </FormGrid>
    </FormModal>
  );
}
