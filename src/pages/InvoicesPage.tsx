import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus, Eye, Search, ChevronRight, Pencil } from "lucide-react";
import { undoable } from "../lib/undo";
import { useInvoices, useUpdateInvoice } from "../db/hooks/useInvoices";
import { useClients } from "../db/hooks/useClients";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import type { InvoiceStatus } from "../types/invoice";

const statusColors: Record<InvoiceStatus, string> = {
  draft: "!bg-gray-100 !text-gray-600 dark:!bg-gray-700 dark:!text-gray-300",
  sent: "!bg-accent-light !text-accent dark:!bg-accent-light dark:!text-accent",
  paid: "!bg-green-100 !text-green-700 dark:!bg-green-900/40 dark:!text-green-300",
  overdue: "!bg-red-100 !text-red-700 dark:!bg-red-900/40 dark:!text-red-300",
  cancelled: "!bg-gray-100 !text-gray-400 dark:!bg-gray-700 dark:!text-gray-500",
};

type SortKey = "reference" | "client_name" | "invoice_date" | "status" | "total";

export function InvoicesPage() {
  const t = useT();
  const { data: invoices, isLoading } = useInvoices();
  const { data: clients } = useClients();
  const updateInvoice = useUpdateInvoice();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "reference", dir: "desc" });
  const currentYear = new Date().getFullYear();
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([currentYear]));

  const clientName = (clientId: string) =>
    clients?.find((c) => c.id === clientId)?.name ?? clientId;

  const enriched = useMemo(() => {
    return (invoices ?? []).map((inv) => ({
      ...inv,
      client_name: clientName(inv.client_id),
    }));
  }, [invoices, clients]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const rows = q
      ? enriched.filter(
          (inv) =>
            inv.reference.toLowerCase().includes(q) ||
            inv.client_name.toLowerCase().includes(q) ||
            inv.status.includes(q)
        )
      : enriched;
    return sortRows(rows, sort.key, sort.dir);
  }, [enriched, search, sort]);

  const groupedByYear = useMemo(() => {
    const groups = new Map<number, typeof filtered>();
    for (const inv of filtered) {
      const year = inv.invoice_date ? parseInt(inv.invoice_date.substring(0, 4)) : currentYear;
      const arr = groups.get(year) ?? [];
      arr.push(inv);
      groups.set(year, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b - a);
  }, [filtered, currentYear]);

  const toggleYear = (year: number) => {
    const next = new Set(expandedYears);
    next.has(year) ? next.delete(year) : next.add(year);
    setExpandedYears(next);
  };

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t.invoices}</h1>
        <Link
          to="/invoices/new"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          <Plus size={16} /> {t.new_invoice}
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Search size={16} className="text-muted" />
        <input
          placeholder={t.search_invoices}
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
              <SortHeader label={t.date} sortKey="invoice_date" current={sort} onSort={setSort} />
              <SortHeader label={t.status} sortKey="status" current={sort} onSort={setSort} />
              <SortHeader label={t.amount} sortKey="total" current={sort} onSort={setSort} align="right" />
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groupedByYear.map(([year, yearInvoices]) => {
              const isOpen = expandedYears.has(year);
              const yearTotal = yearInvoices.reduce((s, i) => s + i.total, 0);
              return (
                <React.Fragment key={year}>
                  <tr
                    className="border-b border-gray-200 bg-gray-50 cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleYear(year)}
                  >
                    <td colSpan={6} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        <span className="font-medium text-sm">{year}</span>
                        <span className="text-xs text-muted">
                          {yearInvoices.length} invoice{yearInvoices.length !== 1 ? "s" : ""}
                        </span>
                        <span className="ml-auto text-sm font-medium">
                          CHF {yearTotal.toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {isOpen &&
                    yearInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <Link
                            to={`/invoices/${inv.id}/edit`}
                            className="inline-flex items-center gap-1.5 text-muted hover:text-accent"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </Link>
                          <span className="ml-1.5">{inv.reference}</span>
                        </td>
                        <td className="px-4 py-2">{inv.client_name}</td>
                        <td className="px-4 py-2 text-muted">{formatDisplayDate(inv.invoice_date)}</td>
                        <td className="px-4 py-2">
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
                            className={`text-xs px-2 py-0.5 rounded-full border-0 appearance-none cursor-pointer ${statusColors[inv.status]}`}
                          >
                            <option value="draft">{t.draft}</option>
                            <option value="sent">{t.sent}</option>
                            <option value="paid">{t.paid}</option>
                            <option value="overdue">{t.overdue}</option>
                            <option value="cancelled">{t.cancelled}</option>
                          </select>
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          CHF {inv.total.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            to={`/invoices/${inv.id}/preview`}
                            className="text-muted hover:text-accent"
                            title="Preview PDF"
                          >
                            <Eye size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  {search ? t.no_matching_invoices : t.no_invoices_yet}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
