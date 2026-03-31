import React, { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Eye, ChevronRight, Pencil, Trash2, CheckCircle, Send, Repeat, X, AlertTriangle, ExternalLink, FileText, Settings2, Download, Mail } from "lucide-react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { addMonths, format } from "date-fns";
import { pdf } from "@react-pdf/renderer";
import { undoable } from "../lib/undo";
import { useInvoices, useUpdateInvoice, useDeleteInvoice } from "../db/hooks/useInvoices";
import { getInvoice, getInvoiceLineItems } from "../db/queries/invoices";
import { getClient, getClientContacts, getClientAddresses } from "../db/queries/clients";
import { getBusinessProfile } from "../db/queries/business-profile";
import { getProject } from "../db/queries/projects";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { postProcessInvoicePdf } from "../lib/pdfPostProcess";
import { useClients } from "../db/hooks/useClients";
import { useRecurringTemplates, useCreateRecurringTemplate, useDeleteRecurringTemplate, useUpdateRecurringTemplate } from "../db/hooks/useRecurring";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useTabStore } from "../stores/tab-store";
import { useYearGrouping } from "../hooks/useYearGrouping";
import { PageHeader, SearchBar, PageSpinner, Button, EmptyState, Card } from "../components/ui";
import { invoiceStatusVariant, statusClasses } from "../lib/statusColors";
import type { Invoice, InvoiceStatus } from "../types/invoice";
import type { RecurringFrequency } from "../types/recurring";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

const FREQUENCIES: RecurringFrequency[] = ["monthly", "quarterly", "biannual", "annual"];

type SortKey = "reference" | "client_name" | "invoice_date" | "status" | "total";

export function InvoicesPage() {
  const t = useT();
  const { data: invoices, isLoading } = useInvoices();
  const { data: clients } = useClients();
  const { data: templates } = useRecurringTemplates();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const createTemplate = useCreateRecurringTemplate();
  const deleteTemplate = useDeleteRecurringTemplate();
  const updateTemplate = useUpdateRecurringTemplate();
  const [search, setSearch] = useState("");
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Invoice & { client_name: string }> | null>(null);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "reference", dir: "desc" });
  const [showRecurring, setShowRecurring] = useState(false);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const invoiceFields = useMemo<FilterableField[]>(() => [
    { key: "reference", label: t.reference, type: "string" },
    { key: "client_name", label: t.client, type: "string" },
    { key: "status", label: t.status, type: "select", options: [
      { value: "draft", label: t.draft },
      { value: "sent", label: t.sent },
      { value: "paid", label: t.paid },
      { value: "overdue", label: t.overdue },
      { value: "cancelled", label: t.cancelled },
    ]},
    { key: "total", label: t.amount, type: "number" },
  ], [t]);

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);

  const enriched = useMemo(() => {
    return (invoices ?? []).map((inv) => ({
      ...inv,
      client_name: clientsMap.get(inv.client_id) ?? inv.client_id,
    }));
  }, [invoices, clientsMap]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = q
      ? enriched.filter(
          (inv) =>
            inv.reference.toLowerCase().includes(q) ||
            inv.client_name.toLowerCase().includes(q) ||
            inv.status.includes(q)
        )
      : enriched;
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    return sortRows(rows, sort.key, sort.dir);
  }, [enriched, search, sort, filterConditions, filterLogic]);

  const bulk = useBulkSelect(filtered);

  const bulkMarkPaid = useCallback(() => {
    const ids = [...bulk.selected] as number[];
    const prevStates = ids.map((id) => {
      const inv = enriched.find((i) => i.id === id);
      return { id, status: inv?.status, paid_date: inv?.paid_date };
    });
    const today = new Date().toISOString().split("T")[0];
    ids.forEach((id) => updateInvoice.mutate({ id, data: { status: "paid" as InvoiceStatus, paid_date: today } }));
    undoable(t.bulk_updated, async () => {
      await Promise.all(
        prevStates.map((prev) =>
          updateInvoice.mutateAsync({ id: prev.id, data: { status: prev.status as InvoiceStatus, paid_date: prev.paid_date } })
        )
      );
    });
    bulk.clearSelection();
  }, [bulk, updateInvoice, enriched, t]);

  const bulkMarkSent = useCallback(() => {
    const ids = [...bulk.selected] as number[];
    const prevStates = ids.map((id) => {
      const inv = enriched.find((i) => i.id === id);
      return { id, status: inv?.status };
    });
    ids.forEach((id) => updateInvoice.mutate({ id, data: { status: "sent" as InvoiceStatus } }));
    undoable(t.bulk_updated, async () => {
      await Promise.all(
        prevStates.map((prev) =>
          updateInvoice.mutateAsync({ id: prev.id, data: { status: prev.status as InvoiceStatus } })
        )
      );
    });
    bulk.clearSelection();
  }, [bulk, updateInvoice, enriched, t]);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    ([...bulk.selected] as number[]).forEach((id) => deleteInvoice.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteInvoice, t]);

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((inv: (typeof filtered)[0]) => inv.invoice_date, [])
  );

  const handleDownloadPdf = async (inv: Invoice & { client_name: string }) => {
    if (inv.reference.startsWith("DRAFT")) {
      const proceed = await ask(t.export_draft_warning, { kind: "warning", okLabel: t.download_pdf, cancelLabel: t.cancel });
      if (!proceed) return;
    }
    try {
      const [fullInvoice, lineItems, client, profile] = await Promise.all([
        getInvoice(inv.id),
        getInvoiceLineItems(inv.id),
        getClient(inv.client_id),
        getBusinessProfile(),
      ]);
      if (!fullInvoice || !client || !profile) {
        toast.error(t.invoice_not_found);
        return;
      }
      const [contacts, addresses, project] = await Promise.all([
        getClientContacts(inv.client_id),
        getClientAddresses(inv.client_id),
        fullInvoice.project_id ? getProject(fullInvoice.project_id) : Promise.resolve(null),
      ]);
      const selectedContact = fullInvoice.contact_id
        ? contacts?.find((c) => c.id === fullInvoice.contact_id)
        : null;
      const contactName = selectedContact
        ? `${selectedContact.first_name} ${selectedContact.last_name}`.trim()
        : undefined;
      const billingAddress = fullInvoice.billing_address_id
        ? addresses?.find((a) => a.id === fullInvoice.billing_address_id) ?? null
        : null;

      const doc = (
        <InvoicePDF
          invoice={fullInvoice}
          lineItems={lineItems}
          client={client}
          profile={profile}
          contactName={contactName}
          billingAddress={billingAddress}
          projectName={project?.name}
          reminderCount={fullInvoice.reminder_count}
        />
      );
      const blob = await pdf(doc).toBlob();
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      const processed = await postProcessInvoicePdf(rawBytes, {
        isCancelled: fullInvoice.status === "cancelled",
      });
      const processedBlob = new Blob([new Uint8Array(processed)], { type: "application/pdf" });
      const url = URL.createObjectURL(processedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fullInvoice.reference}_${client.name}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t.download_pdf);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleEmailPdf = async (inv: Invoice & { client_name: string }) => {
    if (inv.reference.startsWith("DRAFT")) {
      const proceed = await ask(t.export_draft_warning, { kind: "warning", okLabel: t.email_pdf, cancelLabel: t.cancel });
      if (!proceed) return;
    }
    try {
      const [fullInvoice, lineItems, client, profile] = await Promise.all([
        getInvoice(inv.id),
        getInvoiceLineItems(inv.id),
        getClient(inv.client_id),
        getBusinessProfile(),
      ]);
      if (!fullInvoice || !client || !profile) {
        toast.error(t.invoice_not_found);
        return;
      }
      const [contacts, addresses, project] = await Promise.all([
        getClientContacts(inv.client_id),
        getClientAddresses(inv.client_id),
        fullInvoice.project_id ? getProject(fullInvoice.project_id) : Promise.resolve(null),
      ]);
      const selectedContact = fullInvoice.contact_id
        ? contacts?.find((c) => c.id === fullInvoice.contact_id)
        : null;
      const contactName = selectedContact
        ? `${selectedContact.first_name} ${selectedContact.last_name}`.trim()
        : undefined;
      const billingAddress = fullInvoice.billing_address_id
        ? addresses?.find((a) => a.id === fullInvoice.billing_address_id) ?? null
        : null;

      const doc = (
        <InvoicePDF
          invoice={fullInvoice}
          lineItems={lineItems}
          client={client}
          profile={profile}
          contactName={contactName}
          billingAddress={billingAddress}
          projectName={project?.name}
          reminderCount={fullInvoice.reminder_count}
        />
      );
      const blob = await pdf(doc).toBlob();
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      const processed = await postProcessInvoicePdf(rawBytes, {
        isCancelled: fullInvoice.status === "cancelled",
      });

      const dataDir = await appDataDir();
      const tempFileName = `${fullInvoice.reference}_${client.name}.pdf`.replace(/[/\\]/g, "_");
      const tempPath = `${dataDir}/temp_${tempFileName}`;
      await writeFile(tempPath, new Uint8Array(processed));

      await invoke("share_pdf_via_mail", {
        path: tempPath,
        to: client.email ?? "",
        subject: fullInvoice.reference,
      });
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleCreateRecurring = (inv: Invoice & { client_name: string }) => {
    const nextDue = format(addMonths(new Date(), 1), "yyyy-MM-dd");
    createTemplate.mutate(
      {
        base_invoice_id: inv.id,
        client_id: inv.client_id,
        frequency: "monthly",
        next_due: nextDue,
        active: 1,
      },
      {
        onSuccess: () => {
          toast.success(t.template_created);
          setShowRecurring(true);
        },
        onError: (e) => toast.error(String(e)),
      }
    );
  };

  const handleGenerateReminder = (inv: Invoice & { client_name: string }) => {
    const newCount = (inv.reminder_count ?? 0) + 1;
    const today = new Date().toISOString().split("T")[0];
    updateInvoice.mutate(
      { id: inv.id, data: { reminder_count: newCount, last_reminder_date: today } },
      {
        onSuccess: () => {
          toast.success(t.reminder_generated);
          navigate(`/invoices/${inv.id}/preview`);
        },
        onError: (e) => toast.error(String(e)),
      }
    );
  };

  const invoiceRef = (id: number) => {
    const inv = invoices?.find((i) => i.id === id);
    if (!inv) return `#${id}`;
    return inv.reference.startsWith("DRAFT") ? t.draft : inv.reference;
  };

  if (isLoading) return <PageSpinner label={t.loading} />;

  return (
    <div>
      <PageHeader title={t.invoices}>
        <Button
          variant="secondary"
          icon={<Repeat size={14} />}
          onClick={() => setShowRecurring(!showRecurring)}
          className={showRecurring ? "border-accent text-accent bg-accent-light" : ""}
        >
          {t.recurring}
          {(templates?.length ?? 0) > 0 && (
            <span className="ml-1 text-xs bg-[var(--color-input-bg)] text-[var(--color-muted)] rounded-full px-1.5 py-0.5">
              {templates?.length}
            </span>
          )}
        </Button>
        <Button icon={<Plus size={16} />} onClick={() => navigate("/invoices/new")}>
          {t.new_invoice}
        </Button>
      </PageHeader>

      {/* Recurring templates panel */}
      {showRecurring && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium">{t.recurring_invoices}</h2>
            <button type="button" onClick={() => setShowRecurring(false)} className="text-muted hover:text-[var(--color-text)]">
              <X size={14} />
            </button>
          </div>
          {(!templates || templates.length === 0) ? (
            <p className="text-sm text-muted">{t.no_recurring_templates}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-header)] text-left text-xs text-muted uppercase">
                  <th className="py-2 pr-2">{t.base_invoice}</th>
                  <th className="py-2 pr-2">{t.client}</th>
                  <th className="py-2 pr-2">{t.frequency}</th>
                  <th className="py-2 pr-2">{t.next_due}</th>
                  <th className="py-2 pr-2">{t.status}</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {templates.map((tmpl) => (
                  <tr key={tmpl.id} className="border-b border-[var(--color-border-divider)]">
                    <td className="py-2 pr-2">{invoiceRef(tmpl.base_invoice_id)}</td>
                    <td className="py-2 pr-2">{clientsMap.get(tmpl.client_id) ?? tmpl.client_id}</td>
                    <td className="py-2 pr-2">
                      <select
                        value={tmpl.frequency}
                        onChange={(e) =>
                          updateTemplate.mutate({ id: tmpl.id, data: { frequency: e.target.value as RecurringFrequency } })
                        }
                        className="text-xs border border-[var(--color-input-border)] rounded px-1.5 py-0.5"
                      >
                        {FREQUENCIES.map((f) => (
                          <option key={f} value={f}>{t[f] ?? f}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2 text-muted">{formatDisplayDate(tmpl.next_due)}</td>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => updateTemplate.mutate({ id: tmpl.id, data: { active: tmpl.active ? 0 : 1 } })}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          tmpl.active
                            ? "bg-green-100 text-green-700"
                            : "bg-[var(--color-input-bg)] text-[var(--color-muted)]"
                        }`}
                      >
                        {tmpl.active ? t.active : t.inactive}
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteTemplate.mutate(tmpl.id, {
                          onSuccess: () => toast.success(t.template_deleted),
                        })}
                        className="text-muted hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <SearchBar
        value={search}
        onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }}
        placeholder={t.search_invoices}
        className="mb-4 w-64"
      />
      <SavedFilterBar
        page="invoices"
        currentFilters={{ search, sort, conditions: filterConditions, conditionLogic: filterLogic }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={invoiceFields}
      />

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-header)]">
              <th className="w-8 px-2 py-2">
                <input type="checkbox" checked={bulk.isAllSelected} onChange={bulk.toggleAll} className="accent-[var(--accent)]" />
              </th>
              <th className="w-8" />
              <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
              <SortHeader label={t.client} sortKey="client_name" current={sort} onSort={setSort} />
              <SortHeader label={t.date} sortKey="invoice_date" current={sort} onSort={setSort} />
              <SortHeader label={t.status} sortKey="status" current={sort} onSort={setSort} />
              <SortHeader label={t.amount} sortKey="total" current={sort} onSort={setSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {groupedByYear.map(([year, yearInvoices]) => {
              const isOpen = expandedYears.has(year);
              const yearTotal = yearInvoices.reduce((s, i) => i.status === "cancelled" ? s : s + (i.chf_equivalent ?? i.total), 0);
              return (
                <React.Fragment key={year}>
                  <tr
                    className="border-b border-[var(--color-border-divider)] cursor-pointer hover:bg-[var(--color-hover-row)] rounded-md"
                    onClick={() => toggleYear(year)}
                  >
                    <td colSpan={7} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        <span className="text-[10px] font-medium uppercase tracking-widest text-muted">{year}</span>
                        <span className="text-xs text-muted">
                          {yearInvoices.length} {yearInvoices.length !== 1 ? t.invoices_count_plural : t.invoices_count_singular}
                        </span>
                        <span className="ml-auto text-sm font-medium">
                          CHF {yearTotal.toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {isOpen &&
                    yearInvoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] rounded-md group"
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: inv }); }}
                      >
                        <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={bulk.selected.has(inv.id)}
                            onChange={(e) => bulk.toggleItem(inv.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                            className="accent-[var(--accent)]"
                          />
                        </td>
                        <td className="w-8 px-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCtxMenu({ x: e.clientX, y: e.clientY, item: inv });
                            }}
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-[var(--color-text-secondary)] transition-opacity"
                          >
                            <Settings2 size={14} />
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <span>{inv.reference.startsWith("DRAFT") ? t.draft : inv.reference}</span>
                        </td>
                        <td className="px-4 py-2.5">{inv.client_name}</td>
                        <td className="px-4 py-2.5 text-muted">{formatDisplayDate(inv.invoice_date)}</td>
                        <td className="px-4 py-2.5">
                          <select
                            value={inv.status}
                            onChange={(e) => {
                              const status = e.target.value as InvoiceStatus;
                              const prevStatus = inv.status;
                              const prevPaidDate = inv.paid_date;
                              const data: Record<string, unknown> = { status };
                              if (status === "paid") data.paid_date = new Date().toISOString().split("T")[0];
                              updateInvoice.mutate(
                                { id: inv.id, data },
                                {
                                  onSuccess: () =>
                                    undoable(t.status_updated, () =>
                                      updateInvoice.mutateAsync({
                                        id: inv.id,
                                        data: { status: prevStatus, paid_date: prevPaidDate },
                                      })
                                    ),
                                }
                              );
                            }}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 appearance-none cursor-pointer ${statusClasses(invoiceStatusVariant(inv.status), inv.status)}`}
                          >
                            {inv.status === "draft" && <option value="draft">{t.draft}</option>}
                            <option value="sent">{t.sent}</option>
                            <option value="paid">{t.paid}</option>
                            <option value="overdue">{t.overdue}</option>
                            <option value="cancelled">{t.cancelled}</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {inv.status === "cancelled" ? (
                            <span className="text-muted">CHF 0.00</span>
                          ) : inv.currency && inv.currency !== "CHF" ? (
                            <span>
                              <span className="text-muted text-xs">{inv.currency} {inv.total.toFixed(2)}</span>
                              {" "}
                              <span>CHF {(inv.chf_equivalent ?? inv.total).toFixed(2)}</span>
                            </span>
                          ) : (
                            <span>CHF {inv.total.toFixed(2)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <EmptyState
            message={search ? t.no_matching_invoices : t.no_invoices_yet}
            icon={<FileText size={32} />}
          />
        )}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.edit, icon: <Pencil size={14} />, onClick: () => navigate(`/invoices/${ctxMenu.item.id}/edit`) },
            { label: t.preview_pdf, icon: <Eye size={14} />, onClick: () => navigate(`/invoices/${ctxMenu.item.id}/preview`) },
            { label: t.download_pdf, icon: <Download size={14} />, onClick: () => handleDownloadPdf(ctxMenu.item) },
            { label: t.email_pdf, icon: <Mail size={14} />, onClick: () => handleEmailPdf(ctxMenu.item) },
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/invoices/${ctxMenu.item.id}/edit`, ctxMenu.item.reference.startsWith("DRAFT") ? t.draft : ctxMenu.item.reference) },
            { label: "", divider: true, onClick: () => {} },
            ...(ctxMenu.item.status === "draft" ? [{ label: t.mark_sent, icon: <Send size={14} />, onClick: () => updateInvoice.mutate({ id: ctxMenu.item.id, data: { status: "sent" } }) }] : []),
            ...(ctxMenu.item.status !== "paid" && ctxMenu.item.status !== "cancelled" ? [{ label: t.mark_paid, icon: <CheckCircle size={14} />, onClick: () => updateInvoice.mutate({ id: ctxMenu.item.id, data: { status: "paid", paid_date: new Date().toISOString().split("T")[0] } }) }] : []),
            ...(ctxMenu.item.status !== "draft" && ctxMenu.item.status !== "cancelled" ? [{ label: t.create_recurring, icon: <Repeat size={14} />, onClick: () => handleCreateRecurring(ctxMenu.item) }] : []),
            ...(ctxMenu.item.status === "overdue" ? [{ label: t.generate_reminder, icon: <AlertTriangle size={14} />, onClick: () => handleGenerateReminder(ctxMenu.item) }] : []),
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteInvoice.mutate(ctxMenu.item.id) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_paid, icon: <CheckCircle size={14} />, onClick: bulkMarkPaid },
          { label: t.mark_sent, icon: <Send size={14} />, onClick: bulkMarkSent },
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}
