import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { undoable } from "../lib/undo";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db/index";
import { useClients } from "../db/hooks/useClients";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import type { Quote, QuoteStatus } from "../types/quote";

async function getQuotes(): Promise<Quote[]> {
  const db = await getDb();
  return db.select<Quote[]>("SELECT * FROM quotes ORDER BY quote_date DESC");
}

async function updateQuoteStatus(id: number, status: QuoteStatus): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE quotes SET status = $1, updated_at = datetime('now') WHERE id = $2", [status, id]);
}

const statusColors: Record<QuoteStatus, string> = {
  draft: "!bg-gray-100 !text-gray-600 dark:!bg-gray-700 dark:!text-gray-300",
  sent: "!bg-accent-light !text-accent dark:!bg-accent-light dark:!text-accent",
  accepted: "!bg-green-100 !text-green-700 dark:!bg-green-900/40 dark:!text-green-300",
  rejected: "!bg-red-100 !text-red-700 dark:!bg-red-900/40 dark:!text-red-300",
  expired: "!bg-yellow-100 !text-yellow-700 dark:!bg-yellow-900/40 dark:!text-yellow-300",
};

type SortKey = "reference" | "client_name" | "quote_date" | "status" | "total";

export function QuotesPage() {
  const { data: quotes, isLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: getQuotes,
  });
  const { data: clients } = useClients();
  const qc = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: QuoteStatus }) =>
      updateQuoteStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
  });

  const t = useT();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "quote_date", dir: "desc" });

  const clientName = (clientId: string) =>
    clients?.find((c) => c.id === clientId)?.name ?? clientId;

  const enriched = useMemo(() => {
    return (quotes ?? []).map((q) => ({
      ...q,
      client_name: clientName(q.client_id),
    }));
  }, [quotes, clients]);

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

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t.quotes}</h1>
        <Link
          to="/quotes/new"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          <Plus size={16} /> {t.new_quote}
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Search size={16} className="text-muted" />
        <input
          placeholder={t.search_quotes}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-64"
        />
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
              <SortHeader label={t.client} sortKey="client_name" current={sort} onSort={setSort} />
              <SortHeader label={t.date} sortKey="quote_date" current={sort} onSort={setSort} />
              <SortHeader label={t.status} sortKey="status" current={sort} onSort={setSort} />
              <SortHeader label={t.amount} sortKey="total" current={sort} onSort={setSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((q) => (
              <tr key={q.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{q.reference}</td>
                <td className="px-4 py-2">{q.client_name}</td>
                <td className="px-4 py-2 text-muted">{formatDisplayDate(q.quote_date)}</td>
                <td className="px-4 py-2">
                  <select
                    value={q.status}
                    onChange={(e) => {
                      const status = e.target.value as QuoteStatus;
                      const prevStatus = q.status;
                      updateStatus.mutate(
                        { id: q.id, status },
                        {
                          onSuccess: () =>
                            undoable(t.status_updated, () =>
                              updateStatus.mutateAsync({ id: q.id, status: prevStatus })
                            ),
                        }
                      );
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
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  {search ? t.no_matching_quotes : t.no_quotes_yet}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
