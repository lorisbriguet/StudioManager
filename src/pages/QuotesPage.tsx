import { useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Eye, Pencil, FileOutput, Check, Trash2, Send, ExternalLink, FolderPlus, FolderKanban, FileText } from "lucide-react";
import { toast } from "sonner";
import { undoable } from "../lib/undo";
import { ask } from "@tauri-apps/plugin-dialog";
import { useClients } from "../db/hooks/useClients";
import { useQuotes, useUpdateQuote, useDeleteQuote } from "../db/hooks/useQuotes";
import { getQuoteLineItems } from "../db/queries/quotes";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { QuoteToProjectWizard } from "../components/QuoteToProjectWizard";
import { useTabStore } from "../stores/tab-store";
import { PageHeader, SearchBar, PageSpinner, Button, EmptyState } from "../components/ui";
import { quoteStatusVariant, statusClasses } from "../lib/statusColors";
import type { Quote, QuoteStatus, QuoteLineItem } from "../types/quote";

type SortKey = "reference" | "client_name" | "quote_date" | "status" | "total";

export function QuotesPage() {
  const { data: quotes, isLoading } = useQuotes();
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

  const applyFilter = useCallback((filters: Record<string, unknown>) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
  }, []);

  const [wizardQuote, setWizardQuote] = useState<(Quote & { client_name: string }) | null>(null);
  const [wizardLineItems, setWizardLineItems] = useState<QuoteLineItem[]>([]);

  const openWizard = async (quote: Quote & { client_name: string }) => {
    if (quote.converted_to_project_id) {
      toast.info(t.project_already_generated);
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
    const rows = q
      ? enriched.filter(
          (quote) =>
            quote.reference.toLowerCase().includes(q) ||
            quote.client_name.toLowerCase().includes(q) ||
            quote.status.includes(q)
        )
      : enriched;
    return sortRows(rows, sort.key, sort.dir);
  }, [enriched, search, sort]);

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

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    ([...bulk.selected] as number[]).forEach((id) => deleteQuote.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteQuote, t]);

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      <PageHeader title={t.quotes}>
        <Button icon={<Plus size={16} />} onClick={() => navigate("/quotes/new")}>
          {t.new_quote}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); }} placeholder={t.search_quotes} className="w-64 mb-4" />
      <SavedFilterBar
        page="quotes"
        currentFilters={{ search, sort }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
      />

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="w-8 px-2 py-2">
                <input type="checkbox" checked={bulk.isAllSelected} onChange={bulk.toggleAll} className="accent-[var(--accent)]" />
              </th>
              <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
              <SortHeader label={t.client} sortKey="client_name" current={sort} onSort={setSort} />
              <SortHeader label={t.date} sortKey="quote_date" current={sort} onSort={setSort} />
              <SortHeader label={t.status} sortKey="status" current={sort} onSort={setSort} />
              <SortHeader label={t.amount} sortKey="total" current={sort} onSort={setSort} align="right" />
              <th className="px-4 py-2 text-right text-xs font-medium text-muted" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((q) => (
              <tr
                key={q.id}
                className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-200 group"
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: q }); }}
              >
                <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={bulk.selected.has(q.id)}
                    onChange={(e) => bulk.toggleItem(q.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                    className="accent-[var(--accent)]"
                  />
                </td>
                <td className="px-4 py-2">
                  <Link
                    to={`/quotes/${q.id}/edit`}
                    className="text-muted hover:text-accent align-middle opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t.edit}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Pencil size={14} className="inline" />
                  </Link>
                  <span className="font-medium ml-1.5 align-middle">{q.reference}</span>
                </td>
                <td className="px-4 py-2">{q.client_name}</td>
                <td className="px-4 py-2 text-muted">{formatDisplayDate(q.quote_date)}</td>
                <td className="px-4 py-2">
                  <select
                    value={q.status}
                    onChange={(e) => {
                      const status = e.target.value as QuoteStatus;
                      updateQuote.mutate({ id: q.id, data: { status } });
                    }}
                    className={`text-xs px-2 py-0.5 rounded-full border-0 appearance-none cursor-pointer ${statusClasses(quoteStatusVariant(q.status))}`}
                  >
                    <option value="draft">{t.draft}</option>
                    <option value="sent">{t.sent}</option>
                    <option value="accepted">{t.accepted}</option>
                    <option value="rejected">{t.rejected}</option>
                    <option value="expired">{t.expired}</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  CHF {q.total.toFixed(2)}
                </td>
                <td className="px-4 py-2 text-right">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-2">
                    <Link
                      to={`/quotes/${q.id}/preview`}
                      className="text-muted hover:text-accent align-middle"
                      title={t.preview}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Eye size={14} className="inline" />
                    </Link>
                    {q.converted_to_project_id ? (
                      <Link
                        to={`/projects/${q.converted_to_project_id}`}
                        className="text-green-500 hover:text-green-400 align-middle"
                        title={t.view_project}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FolderKanban size={14} className="inline" />
                      </Link>
                    ) : null}
                    {q.converted_to_invoice_id ? (
                      <span className="text-green-500 align-middle" title={t.already_converted}>
                        <Check size={14} className="inline" />
                      </span>
                    ) : (
                      <Link
                        to={`/invoices/new?from_quote=${q.id}`}
                        className="text-muted hover:text-accent align-middle"
                        title={t.convert_to_invoice}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FileOutput size={14} className="inline" />
                      </Link>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !isLoading && (
          <EmptyState message={search ? t.no_matching_quotes : t.no_quotes_yet} icon={<FileText size={32} />} />
        )}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.edit, icon: <Pencil size={14} />, onClick: () => navigate(`/quotes/${ctxMenu.item.id}/edit`) },
            { label: t.preview_pdf, icon: <Eye size={14} />, onClick: () => navigate(`/quotes/${ctxMenu.item.id}/preview`) },
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/quotes/${ctxMenu.item.id}/edit`, ctxMenu.item.reference) },
            { label: "", divider: true, onClick: () => {} },
            ...(ctxMenu.item.status === "draft" ? [{ label: t.mark_sent, icon: <Send size={14} />, onClick: () => updateQuote.mutate({ id: ctxMenu.item.id, data: { status: "sent" as QuoteStatus } }) }] : []),
            ...(!ctxMenu.item.converted_to_invoice_id ? [{ label: t.convert_to_invoice, icon: <FileOutput size={14} />, onClick: () => navigate(`/invoices/new?from_quote=${ctxMenu.item.id}`) }] : []),
            ...(ctxMenu.item.status === "accepted" && !ctxMenu.item.converted_to_project_id ? [{ label: t.generate_project, icon: <FolderPlus size={14} />, onClick: () => openWizard(ctxMenu.item) }] : []),
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteQuote.mutate(ctxMenu.item.id) },
          ]}
        />
      )}

      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_sent, icon: <Send size={14} />, onClick: bulkMarkSent },
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
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
