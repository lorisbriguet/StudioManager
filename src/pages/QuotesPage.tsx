import { formatMoney } from "../lib/money";
import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { notify } from "../lib/notify";
import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { undoableAction, batchUndo, deleteWithUndo } from "../lib/undo";
import { settleDraftBeforeExport } from "../lib/confirmDraftExport";
import { useBulkDelete } from "../hooks/useBulkDelete";
import { pdfFileName } from "../lib/pdfFilename";
import { orgPaths } from "../lib/orgPaths";
import { runBulkPdfExport } from "../lib/bulkPdfExport";
import { getQuoteLineItems } from "../db/queries/quotes";
import { useClients } from "../db/hooks/useClients";
import { useQuotes, useUpdateQuote, useDeleteQuote } from "../db/hooks/useQuotes";
import { SortHeader, type SortState } from "../components/ui/SortHeader";
import { sortDocuments } from "../lib/documentSort";
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
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";
import { PILL } from "../components/ui/tokens";

// Dynamic import keeps @react-pdf out of the main chunk until a PDF is needed.
const buildQuotePdf = async (id: number) =>
  (await import("../lib/documentPdf")).buildQuotePdf(id);

type SortKey = "reference" | "client_name" | "quote_date" | "status" | "total";

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
    settleDraftBeforeExport(q, () => updateQuote.mutateAsync({ id: q.id, data: { status: "sent" } }));

  const doDownloadPdf = async (q: Quote & { client_name: string }) => {
    if (!(await settleDraft(q))) return;
    await notify.progress(
      t.generating_pdf,
      (async () => {
        const result = await buildQuotePdf(q.id);
        if (!result) throw new Error(t.quote_not_found);
        const blob = new Blob([result.bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfFileName(result.fileStem);
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
        const result = await buildQuotePdf(q.id);
        if (!result) throw new Error(t.quote_not_found);
        const { root } = await orgPaths();
        const tempPath = `${root}/temp_${pdfFileName(result.fileStem)}`;
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
    return sortDocuments(rows, sort.key, sort.dir);
  }, [enriched, search, sort, filterConditions, filterLogic]);

  // Keyboard row navigation (flat list — every filtered row is visible).
  const openQuote = useCallback((q: Quote) => navigate(`/quotes/${q.id}/edit`), [navigate]);
  const { focusIdx } = useListNavigation({
    items: filtered,
    onOpen: openQuote,
    onMenu: useCallback((q: (typeof filtered)[0], pos: { x: number; y: number }) => setCtxMenu({ ...pos, item: q }), []),
  });

  const bulk = useBulkSelect(filtered);

  const bulkMarkSent = useCallback(async () => {
    const ids = [...bulk.selected] as number[];
    bulk.clearSelection();
    // One at a time, each numbered after the previous one is saved. A send
    // that assigns a number adds no undo step and clears the history (undo
    // would free the number), so there is usually no Undo toast; any other
    // undo steps fold into one.
    const action = await batchUndo(t.bulk_updated, async () => {
      for (const id of ids) {
        try {
          await updateQuote.mutateAsync({ id, data: { status: "sent" as QuoteStatus } });
        } catch {
          // the mutation's error toast already told the user
        }
      }
    });
    if (action) undoableAction(t.bulk_updated, action);
  }, [bulk, updateQuote, t]);

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
      generate: (d) => buildQuotePdf(d.id),
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
                {formatMoney(q.total, "CHF")}
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
