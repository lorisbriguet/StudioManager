import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { notify } from "../lib/notify";
import { pdf } from "@react-pdf/renderer";
import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { undoable, deleteWithUndo } from "../lib/undo";
import { settleDraftBeforeExport } from "../lib/confirmDraftExport";
import { useBulkDelete } from "../hooks/useBulkDelete";
import { pdfFileName } from "../lib/pdfFilename";
import { orgPaths } from "../lib/orgPaths";
import { runBulkPdfExport } from "../lib/bulkPdfExport";
import { useClients } from "../db/hooks/useClients";
import { useQuotes, useUpdateQuote, useDeleteQuote } from "../db/hooks/useQuotes";
import { getQuote, getQuoteLineItems } from "../db/queries/quotes";
import { getClient, getClientAddresses } from "../db/queries/clients";
import { getBusinessProfile } from "../db/queries/business-profile";
import { getProject } from "../db/queries/projects";
import { QuotePDF } from "../components/quote/QuotePDF";
import { SortHeader, sortRows, type SortState } from "../components/ui/SortHeader";
import { useListNavigation } from "../hooks/useListNavigation";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { QuoteToProjectWizard } from "../components/QuoteToProjectWizard";
import { useTabStore } from "../stores/tab-store";
import { ICONS, PageHeader, SearchBar, Table, TableSkeleton, Button, EmptyState, QueryState, NoResults, Select, IconButton } from "../components/ui";
import { quoteStatusVariant, statusClasses } from "../lib/statusColors";
import type { Quote, QuoteStatus, QuoteLineItem } from "../types/quote";
import type { Client } from "../types/client";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";
import { PILL } from "../components/ui/tokens";

type SortKey = "reference" | "client_name" | "quote_date" | "status" | "total";

/**
 * Fetch everything the QuotePDF document needs and render it to PDF bytes.
 * Shared by download, email and bulk export. Returns null when the quote,
 * client or business profile is missing (caller surfaces t.quote_not_found).
 * `reference` is the filename-safe form (drafts collapse to "DRAFT").
 */
async function generateQuotePdfBytes(
  quoteId: number,
  clientId: string
): Promise<{ bytes: Uint8Array<ArrayBuffer>; reference: string; client: Client } | null> {
  const [fullQuote, lineItems, client, profile] = await Promise.all([
    getQuote(quoteId),
    getQuoteLineItems(quoteId),
    getClient(clientId),
    getBusinessProfile(),
  ]);
  if (!fullQuote || !client || !profile) return null;
  const [addresses, project] = await Promise.all([
    getClientAddresses(clientId),
    fullQuote.project_id ? getProject(fullQuote.project_id) : Promise.resolve(null),
  ]);
  const billingAddress = fullQuote.billing_address_id
    ? addresses?.find((a) => a.id === fullQuote.billing_address_id) ?? null
    : null;

  const doc = (
    <QuotePDF
      quote={fullQuote}
      lineItems={lineItems}
      client={client}
      profile={profile}
      billingAddress={billingAddress}
      projectName={project?.name}
    />
  );
  const blob = await pdf(doc).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const reference = fullQuote.reference.startsWith("DRAFT") ? "DRAFT" : fullQuote.reference;
  return { bytes, reference, client };
}

export function QuotesPage() {
  const quotesQuery = useQuotes();
  const { data: quotes } = quotesQuery;
  const { data: clients } = useClients();
  const updateQuote = useUpdateQuote();

  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const deleteQuote = useDeleteQuote();
  const t = useT();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "quote_date", dir: "desc" });
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Quote & { client_name: string }> | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const quoteFields = useMemo<FilterableField[]>(() => [
    { key: "reference", label: t.reference, type: "string" },
    { key: "client_name", label: t.client, type: "string" },
    { key: "status", label: t.status, type: "select", options: [
      { value: "draft", label: t.draft },
      { value: "sent", label: t.sent },
      { value: "accepted", label: t.accepted },
      { value: "rejected", label: t.rejected },
      { value: "expired", label: t.expired },
    ]},
    { key: "total", label: t.amount, type: "number" },
  ], [t]);

  const [wizardQuote, setWizardQuote] = useState<(Quote & { client_name: string }) | null>(null);
  const [wizardLineItems, setWizardLineItems] = useState<QuoteLineItem[]>([]);

  // PDF generation runs for seconds; the actions live in the context menu,
  // which can't show a spinner — so guard per-quote against double-fire
  // (ref: no re-render needed) and surface progress via a loading toast.
  const busyPdfIds = useRef<Set<number>>(new Set());

  const handleDownloadPdf = async (q: Quote & { client_name: string }) => {
    if (busyPdfIds.current.has(q.id)) return;
    busyPdfIds.current.add(q.id);
    try {
      await doDownloadPdf(q);
    } finally {
      busyPdfIds.current.delete(q.id);
    }
  };

  const settleDraft = (q: Quote) =>
    settleDraftBeforeExport(q.reference, () => updateQuote.mutateAsync({ id: q.id, data: { status: "sent" } }));

  const doDownloadPdf = async (q: Quote & { client_name: string }) => {
    if (!(await settleDraft(q))) return;
    await notify.progress(
      t.generating_pdf,
      (async () => {
        const result = await generateQuotePdfBytes(q.id, q.client_id);
        if (!result) throw new Error(t.quote_not_found);
        const blob = new Blob([result.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfFileName(result.reference, result.client.name);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })(),
      { success: t.pdf_downloaded, error: t.failed_to_generate_pdf }
    );
  };

  const handleEmailPdf = async (q: Quote & { client_name: string }) => {
    if (busyPdfIds.current.has(q.id)) return;
    busyPdfIds.current.add(q.id);
    try {
      await doEmailPdf(q);
    } finally {
      busyPdfIds.current.delete(q.id);
    }
  };

  const doEmailPdf = async (q: Quote & { client_name: string }) => {
    if (!(await settleDraft(q))) return;
    await notify.progress(
      t.generating_pdf,
      (async () => {
        const result = await generateQuotePdfBytes(q.id, q.client_id);
        if (!result) throw new Error(t.quote_not_found);
        const { root } = await orgPaths();
        const tempPath = `${root}/temp_${pdfFileName(result.reference, result.client.name)}`;
        await writeFile(tempPath, result.bytes);

        await invoke("share_pdf_via_mail", {
          path: tempPath,
          to: result.client.email ?? "",
          subject: result.reference,
        });
      })(),
      { success: null, error: t.error_email_pdf }
    );
  };

  const openWizard = async (quote: Quote & { client_name: string }) => {
    if (quote.converted_to_project_id) {
      notify.info(t.project_already_generated);
      return;
    }
    const items = await getQuoteLineItems(quote.id);
    setWizardLineItems(items);
    setWizardQuote(quote);
  };

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);

  const enriched = useMemo(() => {
    return (quotes ?? []).map((q) => ({
      ...q,
      client_name: clientsMap.get(q.client_id) ?? q.client_id,
    }));
  }, [quotes, clientsMap]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = q
      ? enriched.filter(
          (quote) =>
            quote.reference.toLowerCase().includes(q) ||
            quote.client_name.toLowerCase().includes(q) ||
            quote.status.includes(q)
        )
      : enriched;
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    return sortRows(rows, sort.key, sort.dir);
  }, [enriched, search, sort, filterConditions, filterLogic]);

  // Keyboard row navigation (flat list — every filtered row is visible).
  const openQuote = useCallback((q: Quote) => navigate(`/quotes/${q.id}/edit`), [navigate]);
  const { focusIdx } = useListNavigation({
    items: filtered,
    onOpen: openQuote,
    onMenu: useCallback((q: (typeof filtered)[0], pos: { x: number; y: number }) => setCtxMenu({ ...pos, item: q }), []),
  });

  const bulk = useBulkSelect(filtered);

  const bulkMarkSent = useCallback(() => {
    const ids = [...bulk.selected] as number[];
    const prevStates = ids.map((id) => {
      const q = filtered.find((quote) => quote.id === id);
      return { id, status: q?.status };
    });
    ids.forEach((id) => updateQuote.mutate({ id, data: { status: "sent" as QuoteStatus } }));
    undoable(t.bulk_updated, async () => {
      await Promise.all(
        prevStates.map((prev) =>
          updateQuote.mutateAsync({ id: prev.id, data: { status: prev.status as QuoteStatus } })
        )
      );
    });
    bulk.clearSelection();
  }, [bulk, updateQuote, filtered, t]);

  const deleteSelection = useBulkDelete("quotes", (id: number) => deleteQuote.mutateAsync(id));
  const bulkDelete = () => void deleteSelection([...bulk.selected] as number[], bulk.clearSelection);

  const bulkExportPdfs = async () => {
    const docs = ([...bulk.selected] as number[])
      .map((id) => enriched.find((q) => q.id === id))
      .filter((q): q is (typeof enriched)[number] => q !== undefined);
    await runBulkPdfExport({
      docs,
      busyIds: busyPdfIds.current,
      t,
      generate: (d) => generateQuotePdfBytes(d.id, d.client_id),
      notFoundMessage: t.quote_not_found,
      logLabel: "quote",
      onDone: bulk.clearSelection,
    });
  };

  const clearFilters = () => {
    setSearch("");
    setFilterConditions([]);
    setActiveFilterId(null);
  };

  return (
    <div>
      <PageHeader title={t.quotes}>
        <Button icon={ICONS.add} onClick={() => navigate("/quotes/new")}>
          {t.new_quote}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }} placeholder={t.search_quotes} className="w-64 mb-4" />
      <SavedFilterBar
        page="quotes"
        currentFilters={{ search, sort, conditions: filterConditions, conditionLogic: filterLogic }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={quoteFields}
      />

      <QueryState query={quotesQuery} skeleton={<TableSkeleton columns={7} />} errorMessage={t.load_error_quotes}>
      {(all) => (
      <Table>
        <Table.Head>
          <Table.SelectAll all={bulk.isAllSelected} some={bulk.selected.size > 0} onToggle={bulk.toggleAll} label={t.select_all} />
          <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
          <SortHeader label={t.client} sortKey="client_name" current={sort} onSort={setSort} />
          <SortHeader label={t.date} sortKey="quote_date" current={sort} onSort={setSort} />
          <SortHeader label={t.status} sortKey="status" current={sort} onSort={setSort} />
          <SortHeader label={t.amount} sortKey="total" current={sort} onSort={setSort} align="right" />
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          {filtered.map((q, qi) => (
            <Table.Row
              key={q.id}
              data-list-row
              focused={qi === focusIdx}
              selected={bulk.selected.has(q.id)}
              onOpen={() => openQuote(q)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: q }); }}
            >
              <Table.Select checked={bulk.selected.has(q.id)} onToggle={(shift) => bulk.toggleItem(q.id, shift)} label={t.select_row.replace("{name}", q.reference)} />
              <Table.Td>
                <span className="font-medium">{q.reference.startsWith("DRAFT") ? t.draft : q.reference}</span>
              </Table.Td>
              <Table.Td>{q.client_name}</Table.Td>
              <Table.Td muted>{formatDisplayDate(q.quote_date)}</Table.Td>
              <Table.Td>
                <Select
                  value={q.status}
                  aria-label={`${t.status}: ${q.reference}`}
                  onChange={(e) => {
                    const status = e.target.value as QuoteStatus;
                    updateQuote.mutate({ id: q.id, data: { status } });
                  }}
                  variant="bare"
                  fullWidth={false}
                  className={`${PILL} ${statusClasses(quoteStatusVariant(q.status))}`}
                >
                  {q.status === "draft" && <option value="draft">{t.draft}</option>}
                  <option value="sent">{t.sent}</option>
                  <option value="accepted">{t.accepted}</option>
                  <option value="rejected">{t.rejected}</option>
                  <option value="expired">{t.expired}</option>
                </Select>
              </Table.Td>
              <Table.Td numeric className="font-medium">
                CHF {q.total.toFixed(2)}
              </Table.Td>
              <Table.Actions>
                <IconButton
                  size="xs"
                  icon={ICONS.more}
                  label={t.more_actions}
                  onClick={(e) => setCtxMenu({ x: e.clientX, y: e.clientY, item: q })}
                />
              </Table.Actions>
            </Table.Row>
          ))}
          {filtered.length === 0 && (
            <Table.Empty colSpan={7}>
              {all.length === 0 ? (
                <EmptyState
                  message={t.no_quotes_yet}
                  icon={ICONS.quote}
                  action={
                    <Button icon={ICONS.add} onClick={() => navigate("/quotes/new")}>
                      {t.new_quote}
                    </Button>
                  }
                />
              ) : (
                <NoResults message={t.no_matching_quotes} onClear={clearFilters} />
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
            { label: t.edit, icon: ICONS.edit, onClick: () => navigate(`/quotes/${ctxMenu.item.id}/edit`) },
            { label: t.preview_pdf, icon: ICONS.preview, onClick: () => navigate(`/quotes/${ctxMenu.item.id}/preview`) },
            { label: t.download_pdf, icon: ICONS.download, onClick: () => handleDownloadPdf(ctxMenu.item) },
            { label: t.email_pdf, icon: ICONS.email, onClick: () => handleEmailPdf(ctxMenu.item) },
            { label: t.open_in_new_tab, icon: ICONS.newTab, onClick: () => openTab(`/quotes/${ctxMenu.item.id}/edit`, ctxMenu.item.reference.startsWith("DRAFT") ? t.draft : ctxMenu.item.reference) },
            { label: "", divider: true, onClick: () => {} },
            ...(ctxMenu.item.status === "draft" ? [{ label: t.mark_sent, icon: ICONS.send, onClick: () => updateQuote.mutate({ id: ctxMenu.item.id, data: { status: "sent" as QuoteStatus } }) }] : []),
            ...(!ctxMenu.item.converted_to_invoice_id ? [{ label: t.convert_to_invoice, icon: ICONS.convertToInvoice, onClick: () => navigate(`/invoices/new?from_quote=${ctxMenu.item.id}`) }] : []),
            ...(ctxMenu.item.status === "accepted" && !ctxMenu.item.converted_to_project_id ? [{ label: t.generate_project, icon: ICONS.newProject, onClick: () => openWizard(ctxMenu.item) }] : []),
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => deleteWithUndo(deleteQuote, ctxMenu.item.id, t.toast_quote_deleted) },
          ]}
        />
      )}

      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_sent, icon: ICONS.send, onClick: bulkMarkSent },
          { label: t.export_pdfs, icon: ICONS.download, onClick: bulkExportPdfs },
          { label: t.delete, icon: ICONS.delete, onClick: bulkDelete, danger: true },
        ]}
      />
      {wizardQuote && (
        <QuoteToProjectWizard
          open={!!wizardQuote}
          onClose={() => setWizardQuote(null)}
          quote={wizardQuote}
          lineItems={wizardLineItems}
          clientName={wizardQuote.client_name}
        />
      )}
    </div>
  );
}
