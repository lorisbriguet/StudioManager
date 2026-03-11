import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Save, Plus, Trash2, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  useClient,
  useUpdateClient,
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  useDeleteClientContact,
} from "../db/hooks/useClients";
import { useProjectsByClient } from "../db/hooks/useProjects";
import { useInvoicesByClient } from "../db/hooks/useInvoices";
import { useT } from "../i18n/useT";
import type { Client } from "../types/client";
import type { ClientContact } from "../types/client";

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading } = useClient(id!);
  const { data: projects } = useProjectsByClient(id!);
  const { data: invoices } = useInvoicesByClient(id!);
  const { data: contacts } = useClientContacts(id!);
  const updateClient = useUpdateClient();
  const t = useT();

  const [form, setForm] = useState<Partial<Client>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (client) setForm(client);
  }, [client]);

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

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;
  if (!client) return <div className="text-muted text-sm">{t.client_not_found}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/clients" className="text-muted hover:text-gray-900">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-xl font-semibold">{client.name}</h1>
        {dirty && (
          <button
            onClick={save}
            className="flex items-center gap-1.5 ml-auto px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
          >
            <Save size={14} /> {t.save}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <Section title={t.details}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.display_name} value={form.name ?? ""} onBlur={(v) => saveField("name", v)} />
              <Field label={t.billing_name} value={form.billing_name ?? ""} onBlur={(v) => saveField("billing_name", v)} />
              <Field label={t.address_line_1} value={form.address_line1 ?? ""} onBlur={(v) => saveField("address_line1", v)} />
              <Field label={t.address_line_2} value={form.address_line2 ?? ""} onBlur={(v) => saveField("address_line2", v)} />
              <Field label={t.postal_city} value={form.postal_city ?? ""} onBlur={(v) => saveField("postal_city", v)} />
              <div>
                <label className="block text-xs font-medium text-muted mb-1">{t.language}</label>
                <select
                  value={form.language ?? "FR"}
                  onChange={(e) => { update("language", e.target.value); saveField("language", e.target.value); }}
                  className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
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
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((form.discount_rate ?? 0.1) * 100)}
                    onChange={(e) => update("discount_rate", Number(e.target.value) / 100)}
                    onBlur={(e) => saveField("discount_rate", Number(e.target.value) / 100)}
                    className="w-16 border border-gray-200 rounded-md px-2 py-1 text-sm text-center"
                  />
                  <span className="text-sm text-muted">%</span>
                </div>
              )}
            </div>
          </Section>

          <ContactsSection clientId={id!} contacts={contacts ?? []} />

          <Section title={t.notes}>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              onBlur={(e) => saveField("notes", e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
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

  const updateField = (
    contact: ClientContact,
    field: keyof Omit<ClientContact, "id" | "client_id">,
    value: string
  ) => {
    updateContact.mutate({
      id: contact.id,
      clientId,
      data: { [field]: value },
    });
  };

  const removeContact = (contact: ClientContact) => {
    deleteContact.mutate(
      { id: contact.id, clientId },
      { onSuccess: () => toast.success(t.contact_removed) }
    );
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
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

      <div className="space-y-3">
        {contacts.map((c) => (
          <ContactCard
            key={c.id}
            contact={c}
            onUpdate={(field, value) => updateField(c, field, value)}
            onDelete={() => removeContact(c)}
          />
        ))}

        {drafts.map((d, idx) => (
          <div
            key={`draft-${idx}`}
            className="border border-dashed border-gray-300 rounded-md p-3 space-y-2"
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
    </div>
  );
}

function ContactCard({
  contact,
  onUpdate,
  onDelete,
}: {
  contact: ClientContact;
  onUpdate: (
    field: keyof Omit<ClientContact, "id" | "client_id">,
    value: string
  ) => void;
  onDelete: () => void;
}) {
  const t = useT();

  return (
    <div className="border border-gray-200 rounded-md p-3 group">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <EditableText
            value={contact.first_name}
            placeholder="First"
            onCommit={(v) => onUpdate("first_name", v)}
          />
          <EditableText
            value={contact.last_name}
            placeholder="Last"
            onCommit={(v) => onUpdate("last_name", v)}
          />
          {contact.role && (
            <span className="text-xs text-muted font-normal">
              —{" "}
              <EditableText
                value={contact.role}
                placeholder="Role"
                onCommit={(v) => onUpdate("role", v)}
              />
            </span>
          )}
          {!contact.role && (
            <EditableText
              value=""
              placeholder="Role"
              className="text-xs text-muted font-normal"
              onCommit={(v) => onUpdate("role", v)}
            />
          )}
        </div>
        <button
          onClick={onDelete}
          title={t.delete}
          className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-opacity"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MiniField
          label={t.email}
          value={contact.email}
          onChange={(v) => onUpdate("email", v)}
          onBlur
        />
        <MiniField
          label={t.phone}
          value={contact.phone}
          onChange={(v) => onUpdate("phone", v)}
          onBlur
        />
      </div>
    </div>
  );
}

/* ── Shared UI ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-medium mb-3">{title}</h2>
      {children}
    </div>
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
      <input
        value={local}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          if (onBlur && local !== value) onBlur(local);
        }}
        className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
      />
    </div>
  );
}

function MiniField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: boolean;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div>
      <label className="block text-[10px] text-muted mb-0.5">{label}</label>
      <input
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          if (!onBlur) onChange(e.target.value);
        }}
        onBlur={() => {
          if (onBlur && local !== value) onChange(local);
        }}
        className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
      />
    </div>
  );
}

function EditableText({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (local !== value) onCommit(local);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (local !== value) onCommit(local);
          }
          if (e.key === "Escape") {
            setEditing(false);
            setLocal(value);
          }
        }}
        className="border-b border-accent bg-transparent outline-none text-sm px-0 py-0 w-20"
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setLocal(value);
        setEditing(true);
      }}
      className={`cursor-pointer hover:text-accent ${className ?? ""}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </span>
  );
}
