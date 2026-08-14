import React, { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Eye, ChevronRight, Pencil, Trash2, CheckCircle, Send, Repeat, X, AlertTriangle, ExternalLink, FileText, Settings2, Download, Mail } from "lucide-react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { pdf } from "@react-pdf/renderer";
import { undoable, undoableFromStore } from "../lib/undo";
import { useInvoices, useUpdateInvoice, useDeleteInvoice } from "../db/hooks/useInvoices";
import { getInvoice, getInvoiceLineItems } from "../db/queries/invoices";
import { getClient, getClientContacts, getClientAddresses } from "../db/queries/clients";
import { getBusinessProfile } from "../db/queries/business-profile";
import { getProject } from "../db/queries/projects";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { postProcessInvoicePdf } from "../lib/pdfPostProcess";
import { pdfFileName } from "../lib/pdfFilename";
import { runBulkPdfExport } from "../lib/bulkPdfExport";
import { useClients } from "../db/hooks/useClients";
import { useRecurringTemplates, useCreateRecurringTemplate, useDeleteRecurringTemplate, useUpdateRecurringTemplate } from "../db/hooks/useRecurring";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { todayLocalISO, parseLocalDate } from "../utils/localDate";
import { advanceDate } from "../utils/recurringDates";
import { useT } from "../i18n/useT";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useTabStore } from "../stores/tab-store";
import { useYearGrouping } from "../hooks/useYearGrouping";
import { PageHeader, SearchBar, TableSkeleton, Button, EmptyState, Card, Modal, FormField, Input, Select } from "../components/ui";
import { invoiceStatusVariant, statusClasses } from "../lib/statusColors";
import { isDraftReference } from "../types/invoice";
import type { Invoice, InvoiceStatus } from "../types/invoice";
import type { Client } from "../types/client";
import type { RecurringFrequency } from "../types/recurring";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

const FREQUENCIES: RecurringFrequency[] = ["monthly", "quarterly", "biannual", "annual"];

type SortKey = "reference" | "client_name" | "invoice_date" | "status" | "total";

/**
 * Fetch everything the InvoicePDF document needs and render it to
 * post-processed PDF bytes. Shared by download, email and bulk export.
 * Returns null when the invoice, client or business profile is missing
 * (caller surfaces t.invoice_not_found).
 */
async function generateInvoicePdfBytes(
  invoiceId: number,
  clientId: string
): Promise<{ bytes: Uint8Array<ArrayBuffer>; reference: string; client: Client } | null> {
  const [fullInvoice, lineItems, client, profile] = await Promise.all([
    getInvoice(invoiceId),
    getInvoiceLineItems(invoiceId),
    getClient(clientId),
    getBusinessProfile(),
  ]);
  if (!fullInvoice || !client || !profile) return null;
  const [contacts, addresses, project] = await Promise.all([
    getClientContacts(clientId),
    getClientAddresses(clientId),
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
  return { bytes: new Uint8Array(processed), reference: fullInvoice.reference, client };
}

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
    const today = todayLocalISO();
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

  // Only drafts (DRAFT- reference) are deletable — invoices that ever had
  // a real reference must be cancelled instead
  const selectionHasNonDraft = useMemo(
    () =>
      ([...bulk.selected] as number[]).some((id) => {
        const inv = enriched.find((i) => i.id === id);
        return inv !== undefined && !isDraftReference(inv.reference);
      }),
    [bulk.selected, enriched]
  );

  const bulkDelete = useCallback(async () => {
    if (selectionHasNonDraft) {
      toast.error(t.invoice_delete_only_drafts);
      return;
    }
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    ([...bulk.selected] as number[]).forEach((id) => deleteInvoice.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteInvoice, selectionHasNonDraft, t]);

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((inv: (typeof filtered)[0]) => inv.invoice_date, [])
  );

  // PDF generation runs for seconds; the actions live in the context menu,
  // which can't show a spinner — so guard per-invoice against double-fire
  // (ref: no re-render needed) and surface progress via a loading toast.
  const busyPdfIds = useRef<Set<number>>(new Set());

  const handleDownloadPdf = async (inv: Invoice & { client_name: string }) => {
    if (busyPdfIds.current.has(inv.id)) return;
    busyPdfIds.current.add(inv.id);
    try {
      await doDownloadPdf(inv);
    } finally {
      busyPdfIds.current.delete(inv.id);
    }
  };

  const doDownloadPdf = async (inv: Invoice & { client_name: string }) => {
    if (inv.reference.startsWith("DRAFT")) {
      const proceed = await ask(t.export_draft_warning, { kind: "warning", okLabel: t.download_pdf, cancelLabel: t.cancel });
      if (!proceed) return;
    }
    const toastId = toast.loading(t.generating_pdf);
    try {
      const result = await generateInvoicePdfBytes(inv.id, inv.client_id);
      if (!result) {
        toast.error(t.invoice_not_found, { id: toastId });
        return;
      }
      const processedBlob = new Blob([result.bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(processedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pdfFileName(result.reference, result.client.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t.download_pdf, { id: toastId });
    } catch (err) {
      toast.error(String(err), { id: toastId });
    }
  };

  const handleEmailPdf = async (inv: Invoice & { client_name: string }) => {
    if (busyPdfIds.current.has(inv.id)) return;
    busyPdfIds.current.add(inv.id);
    try {
      await doEmailPdf(inv);
    } finally {
      busyPdfIds.current.delete(inv.id);
    }
  };

  const doEmailPdf = async (inv: Invoice & { client_name: string }) => {
    if (inv.reference.startsWith("DRAFT")) {
      const proceed = await ask(t.export_draft_warning, { kind: "warning", okLabel: t.email_pdf, cancelLabel: t.cancel });
      if (!proceed) return;
    }
    const toastId = toast.loading(t.generating_pdf);
    try {
      const result = await generateInvoicePdfBytes(inv.id, inv.client_id);
      if (!result) {
        toast.error(t.invoice_not_found, { id: toastId });
        return;
      }
      const dataDir = await appDataDir();
      const tempPath = `${dataDir}/temp_${pdfFileName(result.reference, result.client.name)}`;
      await writeFile(tempPath, result.bytes);

      await invoke("share_pdf_via_mail", {
        path: tempPath,
        to: result.client.email ?? "",
        subject: result.reference,
      });
      toast.dismiss(toastId);
    } catch (err) {
      toast.error(String(err), { id: toastId });
    }
  };

  const bulkExportPdfs = async () => {
    const docs = ([...bulk.selected] as number[])
      .map((id) => enriched.find((i) => i.id === id))
      .filter((i): i is (typeof enriched)[number] => i !== undefined);
    await runBulkPdfExport({
      docs,
      busyIds: busyPdfIds.current,
      t,
      generate: (d) => generateInvoicePdfBytes(d.id, d.client_id),
      notFoundMessage: t.invoice_not_found,
      logLabel: "invoice",
      onDone: bulk.clearSelection,
    });
  };

  // "Make recurring..." modal — the single canonical creation flow for
  // recurring templates (opened from the invoice context menu).
  const [recurringInv, setRecurringInv] = useState<(Invoice & { client_name: string }) | null>(null);
  const [recFrequency, setRecFrequency] = useState<RecurringFrequency>("monthly");
  const [recNextDue, setRecNextDue] = useState("");
  const [recNextDueTouched, setRecNextDueTouched] = useState(false);

  // Default next_due: one period after the invoice date, advanced until it is
  // strictly in the future — converting an old invoice must not pre-fill a
  // past date, or the catch-up loop in useRecurringCheck would generate one
  // surprise draft per elapsed period on the next launch.
  const defaultNextDue = (inv: Invoice, f: RecurringFrequency) => {
    const anchorDay = parseLocalDate(inv.invoice_date).getDate();
    const today = todayLocalISO();
    let due = advanceDate(inv.invoice_date, f, anchorDay);
    while (due <= today) due = advanceDate(due, f, anchorDay);
    return due;
  };

  const openMakeRecurring = (inv: Invoice & { client_name: string }) => {
    setRecFrequency("monthly");
    setRecNextDue(defaultNextDue(inv, "monthly"));
    setRecNextDueTouched(false);
    setRecurringInv(inv);
  };

  const handleRecFrequencyChange = (f: RecurringFrequency) => {
    setRecFrequency(f);
    // Keep the default in sync with the period as long as the user has not
    // edited the date manually.
    if (!recNextDueTouched && recurringInv) {
      setRecNextDue(defaultNextDue(recurringInv, f));
    }
  };

  const confirmMakeRecurring = async () => {
    if (!recurringInv || !recNextDue) return;
    // A manually chosen past date triggers the catch-up loop (one draft per
    // elapsed period) — legitimate for intentional backfill, so warn, don't block.
    if (recNextDue < todayLocalISO()) {
      const proceed = await ask(t.recurring_past_date_warning, { kind: "warning", okLabel: t.create, cancelLabel: t.cancel });
      if (!proceed) return;
    }
    createTemplate.mutate(
      {
        base_invoice_id: recurringInv.id,
        client_id: recurringInv.client_id,
        frequency: recFrequency,
        next_due: recNextDue,
        active: 1,
      },
      {
        onSuccess: () => {
          toast.success(t.template_created);
          setRecurringInv(null);
          setShowRecurring(true);
        },
      }
    );
  };

  // Row-level one-click "mark paid today" with undo, matching the status
  // dropdown and bulk actions. No undo when coming from draft: reverting to
  // draft is forbidden (the real reference is already assigned).
  const markPaidToday = (inv: Invoice & { client_name: string }) => {
    const prevStatus = inv.status;
    const prevPaidDate = inv.paid_date;
    updateInvoice.mutate(
      { id: inv.id, data: { status: "paid", paid_date: todayLocalISO() } },
      {
        onSuccess: () => {
          if (prevStatus !== "draft") {
            undoable(t.status_updated, () =>
              updateInvoice.mutateAsync({
                id: inv.id,
                data: { status: prevStatus, paid_date: prevPaidDate },
              })
            );
          }
        },
      }
    );
  };

  const handleGenerateReminder = (inv: Invoice & { client_name: string }) => {
    const newCount = (inv.reminder_count ?? 0) + 1;
    const today = todayLocalISO();
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

  const header = (
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
  );

  if (isLoading) return (
    <div>
      {header}
      <TableSkeleton columns={6} />
    </div>
  );

  return (
    <div>
      {header}

      {/* Recurring templates panel */}
      {showRecurring && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium">{t.recurring_invoices}</h2>
            <button type="button" onClick={() => setShowRecurring(false)} aria-label={t.close} className="text-muted hover:text-[var(--color-text)]">
              <X size={14} />
            </button>
          </div>
          {(!templates || templates.length === 0) ? (
            <div>
              <p className="text-sm text-muted">{t.no_recurring_templates}</p>
              <p className="text-sm text-muted mt-1">{t.recurring_empty_hint}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-header)] text-left text-xs text-muted uppercase">
                  <th className="py-2 pr-2">{t.base_invoice}</th>
                  <th className="py-2 pr-2">{t.client}</th>
                  <th className="py-2 pr-2 text-right">{t.amount}</th>
                  <th className="py-2 pr-2">{t.frequency}</th>
                  <th className="py-2 pr-2">{t.next_due}</th>
                  <th className="py-2 pr-2">{t.status}</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {templates.map((tmpl) => {
                  const baseInv = invoices?.find((i) => i.id === tmpl.base_invoice_id);
                  return (
                  <tr key={tmpl.id} className="border-b border-[var(--color-border-divider)]">
                    <td className="py-2 pr-2">
                      {baseInv ? (isDraftReference(baseInv.reference) ? t.draft : baseInv.reference) : `#${tmpl.base_invoice_id}`}
                    </td>
                    <td className="py-2 pr-2">{clientsMap.get(tmpl.client_id) ?? tmpl.client_id}</td>
                    <td className="py-2 pr-2 text-right">
                      {baseInv ? `CHF ${(baseInv.chf_equivalent ?? baseInv.total).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        value={tmpl.frequency}
                        onChange={(e) =>
                          updateTemplate.mutate({ id: tmpl.id, data: { frequency: e.target.value as RecurringFrequency } })
                        }
                        className="text-xs border border-[var(--color-input-border)] rounded-lg px-1.5 py-0.5"
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
                            ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                            : "bg-[var(--color-input-bg)] text-[var(--color-muted)]"
                        }`}
                      >
                        {tmpl.active ? t.active : t.inactive}
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!(await ask(t.confirm_delete_template, { kind: "warning" }))) return;
                          deleteTemplate.mutate(tmpl.id, {
                            onSuccess: () => toast.success(t.template_deleted),
                          });
                        }}
                        className="text-muted hover:text-[var(--color-danger-text)]"
                        aria-label={t.delete_template}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
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
                            aria-label={t.more_actions}
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
                              if (status === "paid") data.paid_date = todayLocalISO();
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
            message={(invoices?.length ?? 0) === 0 ? t.no_invoices_yet : t.no_matching_invoices}
            icon={<FileText size={32} />}
            action={(invoices?.length ?? 0) === 0 ? (
              <Button icon={<Plus size={16} />} onClick={() => navigate("/invoices/new")}>
                {t.new_invoice}
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
            { label: t.edit, icon: <Pencil size={14} />, onClick: () => navigate(`/invoices/${ctxMenu.item.id}/edit`) },
            { label: t.preview_pdf, icon: <Eye size={14} />, onClick: () => navigate(`/invoices/${ctxMenu.item.id}/preview`) },
            { label: t.download_pdf, icon: <Download size={14} />, onClick: () => handleDownloadPdf(ctxMenu.item) },
            { label: t.email_pdf, icon: <Mail size={14} />, onClick: () => handleEmailPdf(ctxMenu.item) },
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/invoices/${ctxMenu.item.id}/edit`, ctxMenu.item.reference.startsWith("DRAFT") ? t.draft : ctxMenu.item.reference) },
            { label: "", divider: true, onClick: () => {} },
            ...(ctxMenu.item.status === "draft" ? [{ label: t.mark_sent, icon: <Send size={14} />, onClick: () => updateInvoice.mutate({ id: ctxMenu.item.id, data: { status: "sent" } }) }] : []),
            ...(ctxMenu.item.status !== "paid" && ctxMenu.item.status !== "cancelled" ? [{ label: t.mark_paid, icon: <CheckCircle size={14} />, onClick: () => markPaidToday(ctxMenu.item) }] : []),
            ...(ctxMenu.item.status !== "draft" && ctxMenu.item.status !== "cancelled" ? [{ label: t.make_recurring, icon: <Repeat size={14} />, onClick: () => openMakeRecurring(ctxMenu.item) }] : []),
            ...(ctxMenu.item.status === "overdue" ? [{ label: t.generate_reminder, icon: <AlertTriangle size={14} />, onClick: () => handleGenerateReminder(ctxMenu.item) }] : []),
            ...(isDraftReference(ctxMenu.item.reference) ? [
              { label: "", divider: true, onClick: () => {} },
              { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteInvoice.mutate(ctxMenu.item.id, { onSuccess: () => undoableFromStore(t.toast_invoice_deleted) }) },
            ] : []),
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_paid, icon: <CheckCircle size={14} />, onClick: bulkMarkPaid },
          { label: t.mark_sent, icon: <Send size={14} />, onClick: bulkMarkSent },
          { label: t.export_pdfs, icon: <Download size={14} />, onClick: bulkExportPdfs },
          ...(selectionHasNonDraft ? [] : [{ label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true }]),
        ]}
      />
      <Modal
        open={recurringInv !== null}
        onClose={() => setRecurringInv(null)}
        title={t.create_recurring}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecurringInv(null)}>{t.cancel}</Button>
            <Button onClick={confirmMakeRecurring} disabled={!recNextDue || createTemplate.isPending}>
              {t.create}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t.frequency}>
            <Select
              value={recFrequency}
              onChange={(e) => handleRecFrequencyChange(e.target.value as RecurringFrequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{t[f] ?? f}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.next_due}>
            <Input
              type="date"
              value={recNextDue}
              onChange={(e) => { setRecNextDue(e.target.value); setRecNextDueTouched(true); }}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
