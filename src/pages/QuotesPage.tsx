import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Eye, Pencil, FileOutput, Check, Trash2, Send, ExternalLink } from "lucide-react";
import { useClients } from "../db/hooks/useClients";
import { useQuotes, useUpdateQuote, useDeleteQuote } from "../db/hooks/useQuotes";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { useTabStore } from "../stores/tab-store";
import { PageHeader, SearchBar, PageSpinner, Button } from "../components/ui";
import type { Quote, QuoteStatus } from "../types/quote";

const statusColors: Record<QuoteStatus, string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  sent: "bg-accent-light text-accent",
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  expired: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
};

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

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      <PageHeader title={t.quotes}>
        <Button icon={<Plus size={16} />} onClick={() => navigate("/quotes/new")}>
          {t.new_quote}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={setSearch} placeholder={t.search_quotes} className="w-64 mb-4" />

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
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
                    className={`text-xs px-2 py-0.5 rounded-full border-0 appearance-none cursor-pointer ${statusColors[q.status]}`}
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  {search ? t.no_matching_quotes : t.no_quotes_yet}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteQuote.mutate(ctxMenu.item.id) },
          ]}
        />
      )}
    </div>
  );
}
