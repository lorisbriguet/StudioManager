import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useClients, useCreateClient, getNextClientId } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import type { Client } from "../types/client";

type SortKey = "id" | "name" | "language" | "discount_rate" | "status";

export function ClientsPage() {
  const t = useT();
  const { data: clients, isLoading } = useClients();
  const { data: projects } = useProjects();
  const createClient = useCreateClient();
  const clientsSortKey = useAppStore((s) => s.clientsSortKey);
  const clientsSortDir = useAppStore((s) => s.clientsSortDir);
  const setClientsSortKey = useAppStore((s) => s.setClientsSortKey);
  const setClientsSortDir = useAppStore((s) => s.setClientsSortDir);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const sort: SortState<SortKey> = { key: clientsSortKey as SortKey, dir: clientsSortDir };
  const setSort = useCallback((s: SortState<SortKey>) => {
    setClientsSortKey(s.key);
    setClientsSortDir(s.dir);
  }, [setClientsSortKey, setClientsSortDir]);

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

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t.clients}</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          <Plus size={16} /> {t.new_client}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Search size={16} className="text-muted" />
        <input
          placeholder={t.search_clients}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-64"
        />
      </div>

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

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <SortHeader label="ID" sortKey="id" current={sort} onSort={setSort} />
              <SortHeader label={t.display_name} sortKey="name" current={sort} onSort={setSort} />
              <SortHeader label={t.language} sortKey="language" current={sort} onSort={setSort} />
              <SortHeader label={t.cultural_discount} sortKey="discount_rate" current={sort} onSort={setSort} />
              <SortHeader label="Status" sortKey="status" current={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
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
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    c.status === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}>
                    {c.status === "active" ? t.active : t.inactive}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  {search ? t.no_matching_clients : t.no_clients}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    <div className="border border-gray-200 rounded-lg p-4 mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          placeholder={`${t.display_name} *`}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder={t.billing_name}
          value={form.billing_name}
          onChange={(e) => setForm({ ...form, billing_name: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder={t.address_line_1}
          value={form.address_line1}
          onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder={t.address_line_2}
          value={form.address_line2}
          onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder={t.postal_city}
          value={form.postal_city}
          onChange={(e) => setForm({ ...form, postal_city: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={form.language}
          onChange={(e) => setForm({ ...form, language: e.target.value as "FR" | "EN" })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
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
        <button
          onClick={() => {
            if (!form.name.trim()) return toast.error(t.toast_name_required);
            onSave({ ...form, billing_name: form.billing_name || form.name });
          }}
          className="px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          {t.save}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-gray-200 text-sm rounded-md hover:bg-gray-50"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
