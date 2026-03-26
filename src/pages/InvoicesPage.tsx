import React, { useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Eye, ChevronRight, Pencil, Trash2, CheckCircle, Send, Repeat, X, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { addMonths, format } from "date-fns";
import { undoable } from "../lib/undo";
import { useInvoices, useUpdateInvoice, useDeleteInvoice } from "../db/hooks/useInvoices";
import { useClients } from "../db/hooks/useClients";
import { useRecurringTemplates, useCreateRecurringTemplate, useDeleteRecurringTemplate, useUpdateRecurringTemplate } from "../db/hooks/useRecurring";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { useTabStore } from "../stores/tab-store";
import { useYearGrouping } from "../hooks/useYearGrouping";
import { PageHeader, SearchBar, PageSpinner, Button } from "../components/ui";
import type { Invoice, InvoiceStatus } from "../types/invoice";
import type { RecurringFrequency } from "../types/recurring";

const statusColors: Record<InvoiceStatus, string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  sent: "bg-accent-light text-accent",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500",
};

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

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);

  const enriched = useMemo(() => {
    return (invoices ?? []).map((inv) => ({
      ...inv,
      client_name: clientsMap.get(inv.client_id) ?? inv.client_id,
    }));
  }, [invoices, clientsMap]);

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

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((inv: (typeof filtered)[0]) => inv.invoice_date, [])
  );

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
            <span className="ml-1 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
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
        <div className="mb-6 border border-gray-100 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium">{t.recurring_invoices}</h2>
            <button type="button" onClick={() => setShowRecurring(false)} className="text-muted hover:text-gray-900">
              <X size={14} />
            </button>
          </div>
          {(!templates || templates.length === 0) ? (
            <p className="text-sm text-muted">{t.no_recurring_templates}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-muted uppercase">
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
                  <tr key={tmpl.id} className="border-b border-gray-100">
                    <td className="py-2 pr-2">{invoiceRef(tmpl.base_invoice_id)}</td>
                    <td className="py-2 pr-2">{clientsMap.get(tmpl.client_id) ?? tmpl.client_id}</td>
                    <td className="py-2 pr-2">
                      <select
                        value={tmpl.frequency}
                        onChange={(e) =>
                          updateTemplate.mutate({ id: tmpl.id, data: { frequency: e.target.value as RecurringFrequency } })
                        }
                        className="text-xs border border-gray-200 rounded px-1.5 py-0.5"
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
                            : "bg-gray-100 text-gray-500"
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
        </div>
      )}

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder={t.search_invoices}
        className="mb-4 w-64"
      />

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
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
              const yearTotal = yearInvoices.reduce((s, i) => i.status === "cancelled" ? s : s + (i.chf_equivalent ?? i.total), 0);
              return (
                <React.Fragment key={year}>
                  <tr
                    className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-200"
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
                      <tr
                        key={inv.id}
                        className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-200 group"
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: inv }); }}
                      >
                        <td className="px-4 py-2">
                          <Link
                            to={`/invoices/${inv.id}/edit`}
                            className="inline-flex items-center gap-1.5 text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </Link>
                          <span className="ml-1.5">{inv.reference.startsWith("DRAFT") ? t.draft : inv.reference}</span>
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
                            {inv.status === "draft" && <option value="draft">{t.draft}</option>}
                            <option value="sent">{t.sent}</option>
                            <option value="paid">{t.paid}</option>
                            <option value="overdue">{t.overdue}</option>
                            <option value="cancelled">{t.cancelled}</option>
                          </select>
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
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
                        <td className="px-4 py-2 text-right">
                          <Link
                            to={`/invoices/${inv.id}/preview`}
                            className="text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
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
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.edit, icon: <Pencil size={14} />, onClick: () => navigate(`/invoices/${ctxMenu.item.id}/edit`) },
            { label: t.preview_pdf, icon: <Eye size={14} />, onClick: () => navigate(`/invoices/${ctxMenu.item.id}/preview`) },
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
    </div>
  );
}
