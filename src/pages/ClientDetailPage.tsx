import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Plus, Trash2, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Input, PageSpinner, Card } from "../components/ui";
import { useTabStore } from "../stores/tab-store";
import {
  useClient,
  useUpdateClient,
  useDeleteClient,
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  useDeleteClientContact,
  useClientAddresses,
  useCreateClientAddress,
  useUpdateClientAddress,
  useDeleteClientAddress,
} from "../db/hooks/useClients";
import { useProjectsByClient } from "../db/hooks/useProjects";
import { useInvoicesByClient } from "../db/hooks/useInvoices";
import { useT } from "../i18n/useT";
import { ClientTimeline } from "../components/ClientTimeline";
import type { Client, ClientContact, ClientAddress } from "../types/client";

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading } = useClient(id!);
  const { data: projects } = useProjectsByClient(id!);
  const { data: invoices } = useInvoicesByClient(id!);
  const { data: contacts } = useClientContacts(id!);
  const { data: addresses } = useClientAddresses(id!);
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const navigate = useNavigate();
  const updateActiveTab = useTabStore((s) => s.updateActiveTab);
  const t = useT();

  const [form, setForm] = useState<Partial<Client>>({});
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (client) setForm(client);
  }, [client]);

  // Update tab label with client name
  useEffect(() => {
    if (client?.name) updateActiveTab(`/clients/${id}`, client.name);
  }, [client?.name, id]);

  const saveField = (field: keyof Client, value: unknown) => {
    if (!id) return;
    setForm((prev) => ({ ...prev, [field]: value }));
    updateClient.mutate(
      { id, data: { [field]: value } as Partial<Omit<Client, "id" | "created_at" | "updated_at">> },
      { onSuccess: () => setDirty(false) }
    );
  };

  const update = (field: keyof Client, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const save = () => {
    if (!id) return;
    const { id: _, created_at, updated_at, ...data } = form as Client;
    updateClient.mutate(
      { id, data },
      {
        onSuccess: () => {
          toast.success(t.client_updated);
          setDirty(false);
        },
      }
    );
  };

  if (isLoading) return <PageSpinner />;
  if (!client) return <div className="text-muted text-sm">{t.client_not_found}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-muted hover:text-[var(--color-text)]">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold">{client.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              onClick={save}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
            >
              <Save size={14} /> {t.save}
            </button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-danger-text)]">{t.confirm_delete_client}</span>
              <button
                onClick={() => {
                  deleteClient.mutate(id!, {
                    onSuccess: () => {
                      toast.success(t.toast_client_deleted);
                      navigate("/clients");
                    },
                  });
                }}
                className="px-2 py-1 bg-[var(--color-danger)] text-white rounded-md text-xs hover:opacity-80"
              >
                {t.delete}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 border border-[var(--color-border-divider)] rounded-md text-xs hover:bg-[var(--color-hover-row)]"
              >
                {t.cancel}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-muted hover:text-[var(--color-danger-text)]"
              title={t.delete}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <Section title={t.details}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.display_name} value={form.name ?? ""} onBlur={(v) => saveField("name", v)} />
              <div>
                <label className="block text-xs font-medium text-muted mb-1">{t.language}</label>
                <select
                  value={form.language ?? "FR"}
                  onChange={(e) => { update("language", e.target.value); saveField("language", e.target.value); }}
                  className="w-full border border-[var(--color-border-divider)] rounded-lg px-3 py-2 text-sm bg-[var(--color-surface)]"
                >
                  <option value="FR">{t.french}</option>
                  <option value="EN">{t.english}</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.has_discount}
                  onChange={(e) => {
                    const v = e.target.checked ? 1 : 0;
                    update("has_discount", v);
                    saveField("has_discount", v);
                    if (v && !form.discount_rate) {
                      update("discount_rate", 0.1);
                      saveField("discount_rate", 0.1);
                    }
                  }}
                />
                <span className="text-sm">{t.cultural_discount}</span>
              </label>
              {!!form.has_discount && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((form.discount_rate ?? 0.1) * 100)}
                    onChange={(e) => update("discount_rate", Number(e.target.value) / 100)}
                    onBlur={(e) => saveField("discount_rate", Number(e.target.value) / 100)}
                    fullWidth={false}
                    className="w-16 px-2 py-1 text-center"
                  />
                  <span className="text-sm text-muted">%</span>
                </div>
              )}
            </div>
          </Section>

          <ContactsSection clientId={id!} contacts={contacts ?? []} />

          <AddressesSection clientId={id!} addresses={addresses ?? []} client={client} />

          <Section title={t.notes}>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              onBlur={(e) => saveField("notes", e.target.value)}
              rows={3}
              className="w-full border border-[var(--color-border-divider)] rounded-lg px-3 py-2 text-sm bg-[var(--color-surface)]"
            />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={`${t.projects} (${projects?.length ?? 0})`}>
            {projects?.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="block py-1.5 text-sm text-accent hover:underline"
              >
                {p.name}
                <span className="ml-2 text-xs text-muted">{p.status}</span>
              </Link>
            ))}
            {(!projects || projects.length === 0) && (
              <div className="text-sm text-muted">{t.no_projects}</div>
            )}
          </Section>

          <Section title={`${t.invoices} (${invoices?.length ?? 0})`}>
            {invoices?.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-1.5 text-sm group">
                <span>{inv.reference}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted">CHF {inv.total.toFixed(2)}</span>
                  <Link
                    to={`/invoices/${inv.id}/preview`}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity"
                    title={t.preview}
                  >
                    <Eye size={14} />
                  </Link>
                  <Link
                    to={`/invoices/${inv.id}/edit`}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity"
                    title={t.edit}
                  >
                    <Pencil size={14} />
                  </Link>
                </div>
              </div>
            ))}
            {(!invoices || invoices.length === 0) && (
              <div className="text-sm text-muted">{t.no_invoices}</div>
            )}
          </Section>

          <Section title={t.client_activity}>
            <ClientTimeline clientId={id!} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ── Contacts Section ── */

interface ContactRow {
  id?: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: string;
}

function ContactsSection({
  clientId,
  contacts,
}: {
  clientId: string;
  contacts: ClientContact[];
}) {
  const createContact = useCreateClientContact();
  const updateContact = useUpdateClientContact();
  const deleteContact = useDeleteClientContact();
  const t = useT();

  const [drafts, setDrafts] = useState<ContactRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ContactRow>({ first_name: "", last_name: "", email: "", phone: "", role: "" });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contactId: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  const addDraft = () =>
    setDrafts((prev) => [
      ...prev,
      { first_name: "", last_name: "", email: "", phone: "", role: "" },
    ]);

  const saveDraft = (idx: number) => {
    const d = drafts[idx];
    if (!d.first_name && !d.last_name) return;
    createContact.mutate(
      { client_id: clientId, ...d },
      {
        onSuccess: () => {
          toast.success(t.contact_added);
          setDrafts((prev) => prev.filter((_, i) => i !== idx));
        },
      }
    );
  };

  const removeDraft = (idx: number) =>
    setDrafts((prev) => prev.filter((_, i) => i !== idx));

  const startEditing = (contact: ClientContact) => {
    setEditingId(contact.id);
    setEditForm({
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      role: contact.role,
    });
  };

  const saveEdit = (contact: ClientContact) => {
    const fields: (keyof Omit<ClientContact, "id" | "client_id">)[] = ["first_name", "last_name", "email", "phone", "role"];
    for (const field of fields) {
      if (editForm[field] !== contact[field]) {
        updateContact.mutate({
          id: contact.id,
          clientId,
          data: { [field]: editForm[field] },
        });
      }
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleEditBlur = (contact: ClientContact) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (editingId === contact.id) saveEdit(contact);
    }, 200);
  };

  const handleEditFocus = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  };

  const removeContact = (contact: ClientContact) => {
    if (editingId === contact.id) setEditingId(null);
    deleteContact.mutate(
      { id: contact.id, clientId },
      { onSuccess: () => toast.success(t.contact_removed) }
    );
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">{t.contacts}</h2>
        <button
          onClick={addDraft}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
        >
          <Plus size={14} /> {t.add}
        </button>
      </div>

      {contacts.length === 0 && drafts.length === 0 && (
        <div className="text-sm text-muted">{t.no_contacts}</div>
      )}

      <div className="space-y-2">
        {contacts.map((c) => (
          editingId === c.id ? (
            <div
              key={c.id}
              className="border border-[var(--color-input-border)] rounded-xl bg-[var(--color-surface)] p-3 space-y-2"
            >
              <div className="grid grid-cols-3 gap-2">
                <MiniField
                  label={t.first_name}
                  value={editForm.first_name}
                  onChange={(v) => setEditForm((prev) => ({ ...prev, first_name: v }))}
                  onBlurCb={() => handleEditBlur(c)}
                  onFocusCb={handleEditFocus}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelEdit();
                    if (e.key === "Enter") saveEdit(c);
                  }}
                />
                <MiniField
                  label={t.last_name}
                  value={editForm.last_name}
                  onChange={(v) => setEditForm((prev) => ({ ...prev, last_name: v }))}
                  onBlurCb={() => handleEditBlur(c)}
                  onFocusCb={handleEditFocus}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelEdit();
                    if (e.key === "Enter") saveEdit(c);
                  }}
                />
                <MiniField
                  label={t.role}
                  value={editForm.role}
                  onChange={(v) => setEditForm((prev) => ({ ...prev, role: v }))}
                  onBlurCb={() => handleEditBlur(c)}
                  onFocusCb={handleEditFocus}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelEdit();
                    if (e.key === "Enter") saveEdit(c);
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniField
                  label={t.email}
                  value={editForm.email}
                  onChange={(v) => setEditForm((prev) => ({ ...prev, email: v }))}
                  onBlurCb={() => handleEditBlur(c)}
                  onFocusCb={handleEditFocus}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelEdit();
                    if (e.key === "Enter") saveEdit(c);
                  }}
                />
                <MiniField
                  label={t.phone}
                  value={editForm.phone}
                  onChange={(v) => setEditForm((prev) => ({ ...prev, phone: v }))}
                  onBlurCb={() => handleEditBlur(c)}
                  onFocusCb={handleEditFocus}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelEdit();
                    if (e.key === "Enter") saveEdit(c);
                  }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={cancelEdit} className="text-xs text-muted hover:text-danger">{t.cancel}</button>
                <button onClick={() => saveEdit(c)} className="text-xs text-accent hover:text-accent-hover font-medium">{t.save}</button>
              </div>
            </div>
          ) : (
            <div
              key={c.id}
              className="relative border border-[var(--color-border-divider)] rounded-xl bg-[var(--color-surface)] px-3 py-2.5 group cursor-default"
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, contactId: c.id });
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">
                  {c.first_name} {c.last_name}
                </span>
                {c.role && (
                  <span className="text-xs text-muted">— {c.role}</span>
                )}
              </div>
              {(c.email || c.phone) && (
                <div className="flex items-center gap-3 mt-0.5">
                  {c.email && <span className="text-xs text-muted">{c.email}</span>}
                  {c.phone && <span className="text-xs text-muted">{c.phone}</span>}
                </div>
              )}
              <button
                onClick={() => startEditing(c)}
                className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 text-muted hover:text-[var(--color-text-secondary)] transition-opacity"
              >
                <Pencil size={14} />
              </button>
            </div>
          )
        ))}

        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
              onClick={() => {
                const contact = contacts.find((c) => c.id === contextMenu.contactId);
                if (contact) startEditing(contact);
                setContextMenu(null);
              }}
            >
              <Pencil size={14} /> {t.edit}
            </button>
            <div className="my-1 border-t border-[var(--color-border-divider)]" />
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-danger-text)] hover:bg-red-50"
              onClick={() => {
                const contact = contacts.find((c) => c.id === contextMenu.contactId);
                if (contact) removeContact(contact);
                setContextMenu(null);
              }}
            >
              <Trash2 size={14} /> {t.delete}
            </button>
          </div>
        )}

        {drafts.map((d, idx) => (
          <div
            key={`draft-${idx}`}
            className="border border-dashed border-[var(--color-input-border)] rounded-xl p-3 space-y-2"
          >
            <div className="grid grid-cols-3 gap-2">
              <MiniField
                label={t.first_name}
                value={d.first_name}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, first_name: v } : x))
                  )
                }
              />
              <MiniField
                label={t.last_name}
                value={d.last_name}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, last_name: v } : x))
                  )
                }
              />
              <MiniField
                label={t.role}
                value={d.role}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, role: v } : x))
                  )
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniField
                label={t.email}
                value={d.email}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, email: v } : x))
                  )
                }
              />
              <MiniField
                label={t.phone}
                value={d.phone}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, phone: v } : x))
                  )
                }
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => removeDraft(idx)}
                className="text-xs text-muted hover:text-danger"
              >
                {t.cancel}
              </button>
              <button
                onClick={() => saveDraft(idx)}
                className="text-xs text-accent hover:text-accent-hover font-medium"
              >
                {t.save}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Addresses Section ── */

interface AddressRow {
  label: string;
  billing_name: string;
  address_line1: string;
  address_line2: string;
  postal_city: string;
}

function AddressCard({
  address: a,
  onUpdate,
  onDelete,
  t,
}: {
  address: ClientAddress;
  onUpdate: (field: keyof Omit<ClientAddress, "id" | "client_id">, value: string) => void;
  onDelete: () => void;
  t: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    label: a.label,
    billing_name: a.billing_name,
    address_line1: a.address_line1,
    address_line2: a.address_line2,
    postal_city: a.postal_city,
  });
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  const save = () => {
    if (form.label !== a.label) onUpdate("label", form.label);
    if (form.billing_name !== a.billing_name) onUpdate("billing_name", form.billing_name);
    if (form.address_line1 !== a.address_line1) onUpdate("address_line1", form.address_line1);
    if (form.address_line2 !== a.address_line2) onUpdate("address_line2", form.address_line2);
    if (form.postal_city !== a.postal_city) onUpdate("postal_city", form.postal_city);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-xl bg-[var(--color-surface)] p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <MiniField label={t.label} value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
          <MiniField label={t.billing_name} value={form.billing_name} onChange={(v) => setForm({ ...form, billing_name: v })} />
          <MiniField label={t.address_line_1} value={form.address_line1} onChange={(v) => setForm({ ...form, address_line1: v })} />
          <MiniField label={t.address_line_2} value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} />
          <MiniField label={t.postal_city} value={form.postal_city} onChange={(v) => setForm({ ...form, postal_city: v })} />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={() => { setForm({ label: a.label, billing_name: a.billing_name, address_line1: a.address_line1, address_line2: a.address_line2, postal_city: a.postal_city }); setEditing(false); }} className="text-xs text-muted hover:text-[var(--color-text-secondary)]">{t.cancel}</button>
          <button onClick={save} className="text-xs text-accent hover:text-accent-hover">{t.save}</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl bg-[var(--color-surface)] p-3 group relative"
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div className="flex items-start justify-between">
        <div>
          {a.label && <span className="text-[10px] font-medium uppercase tracking-widest text-muted">{a.label}</span>}
          <div className="mt-1 text-sm">
            {a.billing_name && <div className="font-medium">{a.billing_name}</div>}
            {a.address_line1 && <div className="text-muted">{a.address_line1}</div>}
            {a.address_line2 && <div className="text-muted">{a.address_line2}</div>}
            {a.postal_city && <div className="text-muted">{a.postal_city}</div>}
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 text-muted hover:text-[var(--color-text-secondary)] transition-opacity"
        >
          <Pencil size={14} />
        </button>
      </div>
      {ctxMenu && createPortal(
        <div
          className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button onClick={() => { setEditing(true); setCtxMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]">
            <Pencil size={14} /> {t.edit}
          </button>
          <button onClick={() => { onDelete(); setCtxMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-danger-text)] hover:bg-red-50">
            <Trash2 size={14} /> {t.delete}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

function AddressesSection({
  clientId,
  addresses,
  client,
}: {
  clientId: string;
  addresses: ClientAddress[];
  client: Client;
}) {
  const createAddress = useCreateClientAddress();
  const updateAddress = useUpdateClientAddress();
  const deleteAddress = useDeleteClientAddress();
  const t = useT();

  const [drafts, setDrafts] = useState<AddressRow[]>([]);

  const addDraft = () =>
    setDrafts((prev) => [
      ...prev,
      { label: "", billing_name: "", address_line1: "", address_line2: "", postal_city: "" },
    ]);

  const saveDraft = (idx: number) => {
    const d = drafts[idx];
    if (!d.label && !d.address_line1) return;
    createAddress.mutate(
      { client_id: clientId, ...d },
      {
        onSuccess: () => {
          toast.success(t.address_added);
          setDrafts((prev) => prev.filter((_, i) => i !== idx));
        },
      }
    );
  };

  const removeDraft = (idx: number) =>
    setDrafts((prev) => prev.filter((_, i) => i !== idx));

  const updateField = (
    addr: ClientAddress,
    field: keyof Omit<ClientAddress, "id" | "client_id">,
    value: string
  ) => {
    updateAddress.mutate({
      id: addr.id,
      clientId,
      data: { [field]: value },
    });
  };

  const removeAddress = (addr: ClientAddress) => {
    deleteAddress.mutate(
      { id: addr.id, clientId },
      { onSuccess: () => toast.success(t.address_removed) }
    );
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">{t.billing_addresses}</h2>
        <button
          onClick={addDraft}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
        >
          <Plus size={14} /> {t.add}
        </button>
      </div>

      <div className="space-y-3">
        {/* Main address — read-only card from client fields */}
        {(client.address_line1 || client.postal_city) && (
          <div className="border border-[var(--color-border-divider)] rounded-xl bg-[var(--color-surface)] p-3 opacity-80">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted">{t.main_address}</span>
            <div className="mt-1 text-sm">
              {(client.billing_name || client.name) && (
                <div className="font-medium">{client.billing_name || client.name}</div>
              )}
              {client.address_line1 && <div className="text-muted">{client.address_line1}</div>}
              {client.address_line2 && <div className="text-muted">{client.address_line2}</div>}
              {client.postal_city && <div className="text-muted">{client.postal_city}</div>}
            </div>
          </div>
        )}

        {addresses.map((a) => (
          <AddressCard
            key={a.id}
            address={a}
            onUpdate={(field, value) => updateField(a, field, value)}
            onDelete={() => removeAddress(a)}
            t={t}
          />
        ))}

        {drafts.map((d, idx) => (
          <div
            key={`draft-addr-${idx}`}
            className="border border-dashed border-[var(--color-input-border)] rounded-md p-3 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <MiniField
                label={t.label}
                value={d.label}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, label: v } : x))
                  )
                }
              />
              <MiniField
                label={t.billing_name}
                value={d.billing_name}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, billing_name: v } : x))
                  )
                }
              />
              <MiniField
                label={t.address_line_1}
                value={d.address_line1}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, address_line1: v } : x))
                  )
                }
              />
              <MiniField
                label={t.address_line_2}
                value={d.address_line2}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, address_line2: v } : x))
                  )
                }
              />
              <MiniField
                label={t.postal_city}
                value={d.postal_city}
                onChange={(v) =>
                  setDrafts((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, postal_city: v } : x))
                  )
                }
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => removeDraft(idx)}
                className="text-xs text-muted hover:text-danger"
              >
                {t.cancel}
              </button>
              <button
                onClick={() => saveDraft(idx)}
                className="text-xs text-accent hover:text-accent-hover font-medium"
              >
                {t.save}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Shared UI ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">{title}</h2>
      {children}
    </Card>
  );
}

function Field({
  label,
  value,
  onBlur,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  onBlur?: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);

  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>
      <Input
        value={local}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          if (onBlur && local !== value) onBlur(local);
        }}
        className="py-2"
      />
    </div>
  );
}

function MiniField({
  label,
  value,
  onChange,
  onBlur,
  onBlurCb,
  onFocusCb,
  onKeyDown,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: boolean;
  onBlurCb?: () => void;
  onFocusCb?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div>
      <label className="block text-[10px] text-muted mb-0.5">{label}</label>
      <Input
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          if (!onBlur) onChange(e.target.value);
        }}
        onBlur={() => {
          if (onBlur && local !== value) onChange(local);
          onBlurCb?.();
        }}
        onFocus={onFocusCb}
        onKeyDown={onKeyDown}
        className="px-2 py-1"
      />
    </div>
  );
}

