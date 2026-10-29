import { useState, useEffect, useRef } from "react";
import { IconButton } from "../components/ui/IconButton";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Save, Plus, Trash2, Eye, Pencil, FolderOpen, FileText, UserRound, Users } from "lucide-react";
import { notify } from "../lib/notify";
import { Checkbox, Button, Input, PageHeader, EmptyState, QueryError, DetailSkeleton, ListSkeleton, Card, Select, SectionLabel, Textarea, ConfirmButton, Tooltip, FormField, FormGrid, FormActions, FormLayout, CARD_GAP, CARD_STACK } from "../components/ui";
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
import { useUnsavedChangesWarning } from "../hooks/useUnsavedChangesWarning";
import { ClientTimeline } from "../components/ClientTimeline";
import { ContextMenu } from "../components/ui/ContextMenu";
import { deleteWithUndo, undoableFromStore } from "../lib/undo";
import type { Client, ClientContact, ClientAddress } from "../types/client";

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const clientQuery = useClient(id!);
  const { data: client } = clientQuery;
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

  // Warn before leaving with unsaved edits (anchor clicks, back/forward,
  // window close, and programmatic navigations via the dirty-guard registry)
  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    if (client) setForm(client);
  }, [client]);

  // Update tab label with client name
  useEffect(() => {
    if (client?.name) updateActiveTab(`/clients/${id}`, client.name);
  }, [client?.name, id, updateActiveTab]);

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
          notify.success(t.client_updated);
          setDirty(false);
        },
      }
    );
  };

  if (client === undefined && id) {
    return clientQuery.isError ? (
      <QueryError message={t.load_error_client} onRetry={clientQuery.refetch} retrying={clientQuery.isFetching} />
    ) : (
      <DetailSkeleton />
    );
  }
  if (!client) {
    return (
      <EmptyState
        icon={Users}
        message={t.client_not_found}
        hint={t.not_found_hint}
        action={<Button variant="secondary" onClick={() => navigate("/clients")}>{t.back_to_clients}</Button>}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={client.name}
        back={() => navigate(-1)}
        actions={<>
          {dirty && (
            <Button icon={<Save size={12} />} onClick={save}>
              {t.save}
            </Button>
          )}
          <ConfirmButton
            label={t.delete}
            question={t.confirm_delete_client}
            icon={<Trash2 size={14} />}
            variant="danger"
            onConfirm={() => deleteWithUndo(deleteClient, id!, t.toast_client_deleted, () => navigate("/clients"))}
          />
        </>}
      />

      <div className={`grid grid-cols-3 ${CARD_GAP}`}>
        <div className={`col-span-2 ${CARD_STACK}`}>
          <Section title={t.details}>
            <FormGrid cols={2}>
              <Field label={t.display_name} value={form.name ?? ""} onBlur={(v) => saveField("name", v)} />
              <FormField label={t.language}>
                <Select
                  value={form.language ?? "FR"}
                  onChange={(e) => { update("language", e.target.value); saveField("language", e.target.value); }}
                >
                  <option value="FR">{t.french}</option>
                  <option value="EN">{t.english}</option>
                </Select>
              </FormField>
            </FormGrid>
            <div className="flex items-center gap-3 mt-3">
              <Checkbox
                label={t.cultural_discount}
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
              {!!form.has_discount && (
                <Input
                  numeric
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((form.discount_rate ?? 0.1) * 100)}
                  onChange={(e) => update("discount_rate", Number(e.target.value) / 100)}
                  onBlur={(e) => saveField("discount_rate", Number(e.target.value) / 100)}
                  unit="%"
                  width="sm"
                  aria-label={t.cultural_discount}
                />
              )}
            </div>
          </Section>

          <ContactsSection clientId={id!} contacts={contacts ?? []} />

          <AddressesSection clientId={id!} addresses={addresses ?? []} client={client} />

          <Section title={t.notes}>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              onBlur={(e) => saveField("notes", e.target.value)}
              aria-label={t.notes}
            />
          </Section>
        </div>

        <div className={CARD_STACK}>
          <Section title={t.projects} count={projects?.length ?? 0}>
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
            {projects === undefined && <ListSkeleton size="sm" rows={2} />}
            {projects?.length === 0 && <EmptyState size="sm" icon={FolderOpen} message={t.no_projects_for_client} />}
          </Section>

          <Section title={t.invoices} count={invoices?.length ?? 0}>
            {invoices?.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-1.5 text-sm group">
                <span>{inv.reference}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted">CHF {inv.total.toFixed(2)}</span>
                  <Tooltip content={t.preview}>
                    <Link
                      to={`/invoices/${inv.id}/preview`}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity"
                      aria-label={t.preview}
                    >
                      <Eye size={14} />
                    </Link>
                  </Tooltip>
                  <Tooltip content={t.edit}>
                    <Link
                      to={`/invoices/${inv.id}/edit`}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity"
                      aria-label={t.edit}
                    >
                      <Pencil size={14} />
                    </Link>
                  </Tooltip>
                </div>
              </div>
            ))}
            {invoices === undefined && <ListSkeleton size="sm" rows={2} />}
            {invoices?.length === 0 && <EmptyState size="sm" icon={FileText} message={t.no_invoices_for_client} />}
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
          notify.success(t.contact_added);
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
      { onSuccess: () => undoableFromStore(t.contact_removed) }
    );
  };

  return (
    <Card>
      <Card.Header
        title={t.contacts}
        count={contacts.length}
        variant="label"
        action={
          <Button variant="link" icon={<Plus size={12} />} onClick={addDraft} className="hover:text-accent-hover">
            {t.add}
          </Button>
        }
      />

      {contacts.length === 0 && drafts.length === 0 && (
        <EmptyState
          size="sm"
          icon={UserRound}
          message={t.no_contacts}
          action={<Button variant="secondary" icon={<Plus size={12} />} onClick={addDraft}>{t.add_contact}</Button>}
        />
      )}

      <div className="space-y-2">
        {contacts.map((c) => (
          editingId === c.id ? (
            <Card key={c.id} tone="inset" padding="sm">
              <FormLayout dense capped={false}>
                <FormGrid cols={3}>
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
                </FormGrid>
                <FormGrid cols={2}>
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
                </FormGrid>
                <FormActions>
                  <Button variant="secondary" onClick={cancelEdit}>{t.cancel}</Button>
                  <Button onClick={() => saveEdit(c)}>{t.save}</Button>
                </FormActions>
              </FormLayout>
            </Card>
          ) : (
            <Card
              key={c.id}
              tone="inset"
              padding="sm"
              className="relative group cursor-default"
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
              <IconButton size="xs"
                icon={Pencil}
                label={t.edit}
                onClick={() => startEditing(c)}
                className="absolute top-3 right-3 opacity-60 hover:opacity-100"
              />
            </Card>
          )
        ))}

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              {
                label: t.edit,
                icon: <Pencil size={14} />,
                onClick: () => {
                  const contact = contacts.find((c) => c.id === contextMenu.contactId);
                  if (contact) startEditing(contact);
                },
              },
              { label: "", divider: true, onClick: () => {} },
              {
                label: t.delete,
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: () => {
                  const contact = contacts.find((c) => c.id === contextMenu.contactId);
                  if (contact) removeContact(contact);
                },
              },
            ]}
          />
        )}

        {drafts.map((d, idx) => (
          <Card key={`draft-${idx}`} tone="dashed" padding="sm">
            <FormLayout dense capped={false}>
              <FormGrid cols={3}>
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
              </FormGrid>
              <FormGrid cols={2}>
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
              </FormGrid>
              <FormActions>
                <Button variant="secondary" onClick={() => removeDraft(idx)}>{t.cancel}</Button>
                <Button onClick={() => saveDraft(idx)}>{t.save}</Button>
              </FormActions>
            </FormLayout>
          </Card>
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

  const save = () => {
    if (form.label !== a.label) onUpdate("label", form.label);
    if (form.billing_name !== a.billing_name) onUpdate("billing_name", form.billing_name);
    if (form.address_line1 !== a.address_line1) onUpdate("address_line1", form.address_line1);
    if (form.address_line2 !== a.address_line2) onUpdate("address_line2", form.address_line2);
    if (form.postal_city !== a.postal_city) onUpdate("postal_city", form.postal_city);
    setEditing(false);
  };

  const cancel = () => {
    setForm({ label: a.label, billing_name: a.billing_name, address_line1: a.address_line1, address_line2: a.address_line2, postal_city: a.postal_city });
    setEditing(false);
  };

  const fieldKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  if (editing) {
    return (
      <Card tone="inset" padding="sm">
        <FormLayout dense capped={false}>
          <FormGrid cols={2}>
            <MiniField label={t.label} value={form.label} onChange={(v) => setForm({ ...form, label: v })} onKeyDown={fieldKeys} />
            <MiniField label={t.billing_name} value={form.billing_name} onChange={(v) => setForm({ ...form, billing_name: v })} onKeyDown={fieldKeys} />
            <MiniField label={t.address_line_1} value={form.address_line1} onChange={(v) => setForm({ ...form, address_line1: v })} onKeyDown={fieldKeys} />
            <MiniField label={t.address_line_2} value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} onKeyDown={fieldKeys} />
            <MiniField label={t.postal_city} value={form.postal_city} onChange={(v) => setForm({ ...form, postal_city: v })} onKeyDown={fieldKeys} />
          </FormGrid>
          <FormActions>
            <Button variant="secondary" onClick={cancel}>{t.cancel}</Button>
            <Button onClick={save}>{t.save}</Button>
          </FormActions>
        </FormLayout>
      </Card>
    );
  }

  return (
    <Card
      tone="inset"
      padding="sm"
      className="group relative"
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div className="flex items-start justify-between">
        <div>
          {a.label && <SectionLabel as="span">{a.label}</SectionLabel>}
          <div className="mt-1 text-sm">
            {a.billing_name && <div className="font-medium">{a.billing_name}</div>}
            {a.address_line1 && <div className="text-muted">{a.address_line1}</div>}
            {a.address_line2 && <div className="text-muted">{a.address_line2}</div>}
            {a.postal_city && <div className="text-muted">{a.postal_city}</div>}
          </div>
        </div>
        <IconButton icon={Pencil} label={t.edit} onClick={() => setEditing(true)} className="opacity-60 hover:opacity-100" />
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.edit, icon: <Pencil size={14} />, onClick: () => setEditing(true) },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: onDelete },
          ]}
        />
      )}
    </Card>
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
          notify.success(t.address_added);
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
      { onSuccess: () => undoableFromStore(t.address_removed) }
    );
  };

  return (
    <Card>
      <Card.Header
        title={t.billing_addresses}
        variant="label"
        action={
          <Button variant="link" icon={<Plus size={12} />} onClick={addDraft} className="hover:text-accent-hover">
            {t.add}
          </Button>
        }
      />

      <div className="space-y-2">
        {/* Main address — read-only card from client fields */}
        {(client.address_line1 || client.postal_city) && (
          <Card tone="inset" padding="sm" className="opacity-80">
            <SectionLabel as="span">{t.main_address}</SectionLabel>
            <div className="mt-1 text-sm">
              {(client.billing_name || client.name) && (
                <div className="font-medium">{client.billing_name || client.name}</div>
              )}
              {client.address_line1 && <div className="text-muted">{client.address_line1}</div>}
              {client.address_line2 && <div className="text-muted">{client.address_line2}</div>}
              {client.postal_city && <div className="text-muted">{client.postal_city}</div>}
            </div>
          </Card>
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
          <Card key={`draft-addr-${idx}`} tone="dashed" padding="sm">
            <FormLayout dense capped={false}>
              <FormGrid cols={2}>
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
              </FormGrid>
              <FormActions>
                <Button variant="secondary" onClick={() => removeDraft(idx)}>{t.cancel}</Button>
                <Button onClick={() => saveDraft(idx)}>{t.save}</Button>
              </FormActions>
            </FormLayout>
          </Card>
        ))}
      </div>
    </Card>
  );
}

/* ── Shared UI ── */

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card>
      <Card.Header title={title} count={count} variant="label" />
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

  const commit = () => {
    focusedRef.current = false;
    if (onBlur && local !== value) onBlur(local);
  };

  return (
    <FormField label={label}>
      <Input
        value={local}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      />
    </FormField>
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
    <FormField label={label}>
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
      />
    </FormField>
  );
}

