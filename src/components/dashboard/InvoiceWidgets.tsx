import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { ICONS, ICON_SIZE } from "../ui/icons";
import { useInvoices } from "../../db/hooks/useInvoices";
import { useClients } from "../../db/hooks/useClients";
import { todayLocalISO } from "../../utils/localDate";
import { getInvoiceAging } from "../../db/queries/invoices";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useNow } from "../../hooks/useNow";
import { useT } from "../../i18n/useT";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { invoiceStatusTextClass } from "../../lib/statusColors";
import { formatMoney } from "../../lib/money";
import { documentDisplayRef } from "../../lib/documentDisplay";
import { InvoiceAmount } from "../invoice/InvoiceAmount";
import { qk } from "../../db/queryKeys";

const STATUS_ICON = {
  draft: ICONS.invoiceDraft,
  sent: ICONS.invoiceSent,
  paid: ICONS.invoicePaid,
  overdue: ICONS.invoiceOverdue,
} as const;

/** Invoice status as an icon plus its name (tooltip, screen readers): not colour alone. */
export function InvoiceStatusIcon({ status }: { status: string }) {
  const t = useT();
  const Icon = STATUS_ICON[status as keyof typeof STATUS_ICON];
  const label = (t as Record<string, string>)[status] ?? status;
  if (!Icon) return null;
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex align-[-1px] ml-2 ${invoiceStatusTextClass(status)}`}>
      <Icon size={ICON_SIZE.control} aria-hidden />
    </span>
  );
}

// ── Recent invoices ──

export function RecentInvoices() {
  const { data: invoices } = useInvoices();
  // Shares the ["clients"] cache key with useClients() (Clients page, etc.) —
  // must use the same hook rather than a narrower inline query, or its
  // result poisons that shared cache entry with truncated rows.
  const { data: clients } = useClients();
  const t = useT();

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);
  const clientName = (clientId: string) => clientsMap.get(clientId) ?? "";

  const recentInvoices = useMemo(() => {
    if (!invoices) return [];
    const priorityOrder: Record<string, number> = { overdue: 0, sent: 1, draft: 2, paid: 3, cancelled: 4 };
    return [...invoices]
      .sort((a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9))
      .slice(0, 5);
  }, [invoices]);

  return (
    <WidgetShell>
      <WidgetTitle action={<Link to="/invoices" className="text-xs text-accent-text hover:underline">{t.view_all}</Link>}>
        {t.recent_invoices}
      </WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {recentInvoices.map((inv) => (
          <Link
            key={inv.id}
            to={`/invoices/${inv.id}/edit`}
            className="flex justify-between items-center text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1.5 -mx-2"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium">{documentDisplayRef(inv, t)}</span>
              <InvoiceStatusIcon status={inv.status} />
              {clientName(inv.client_id) && (
                <span className="text-xs text-muted ml-2 truncate">{clientName(inv.client_id)}</span>
              )}
            </div>
            <InvoiceAmount invoice={inv} className="text-muted shrink-0 ml-2" />
          </Link>
        ))}
        {invoices === undefined ? <ListSkeleton size="sm" rows={3} /> : recentInvoices.length === 0 && (
          <EmptyState size="sm" icon={ICONS.invoice} message={t.no_invoices_yet} />
        )}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Unpaid invoices ──

export function UnpaidInvoices() {
  const { data: invoices } = useInvoices();
  const { data: clients } = useClients();
  const t = useT();

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);
  const clientName = (clientId: string) => clientsMap.get(clientId) ?? "";

  const now = useNow();
  const unpaid = useMemo(() => {
    if (!invoices) return [];
    return invoices
      .filter((inv) => inv.status === "sent" || inv.status === "overdue")
      .map((inv) => {
        const daysOut = Math.floor((now - new Date(inv.invoice_date).getTime()) / 86400000);
        return { ...inv, daysOut };
      })
      .sort((a, b) => b.daysOut - a.daysOut);
  }, [invoices, now]);

  return (
    <WidgetShell>
      <WidgetTitle>{t.unpaid_invoices}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {unpaid.map((inv) => (
          <Link key={inv.id} to={`/invoices/${inv.id}/edit`} className="flex justify-between items-center text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1.5 -mx-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{inv.reference}</span>
              <InvoiceStatusIcon status={inv.status} />
              {clientName(inv.client_id) && <span className="text-xs text-muted ml-2">{clientName(inv.client_id)}</span>}
            </div>
            <div className="text-right shrink-0 ml-2">
              <div className="text-muted text-xs">{inv.daysOut} {t.days_outstanding}</div>
              <InvoiceAmount invoice={inv} className="block text-sm" />
            </div>
          </Link>
        ))}
        {invoices === undefined ? <ListSkeleton size="sm" rows={3} /> : unpaid.length === 0 && <EmptyState size="sm" message={t.no_unpaid_invoices} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Upcoming reminders (invoices near payment deadline) ──

export function UpcomingReminders() {
  const { data: invoices } = useInvoices();
  const { data: clients } = useClients();
  const t = useT();
  const today = todayLocalISO();
  const now = useNow();

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);
  const clientName = (clientId: string) => clientsMap.get(clientId) ?? "";

  const upcoming = useMemo(() => {
    if (!invoices) return [];
    return invoices
      .filter((inv) => inv.status === "sent" && inv.due_date && inv.due_date >= today)
      .map((inv) => {
        const daysLeft = Math.floor((new Date(inv.due_date!).getTime() - now) / 86400000);
        return { ...inv, daysLeft };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 8);
  }, [invoices, today, now]);

  return (
    <WidgetShell>
      <WidgetTitle>{t.upcoming_reminders}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {upcoming.map((inv) => (
          <Link key={inv.id} to={`/invoices/${inv.id}/edit`} className="flex justify-between items-center text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1.5 -mx-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{inv.reference}</span>
              <span className="text-xs text-muted ml-2">{clientName(inv.client_id)}</span>
            </div>
            <span className={`text-xs shrink-0 ml-2 ${inv.daysLeft <= 3 ? "text-danger-text" : inv.daysLeft <= 7 ? "text-warning-text" : "text-muted"}`}>
              {inv.daysLeft} {t.days_outstanding}
            </span>
          </Link>
        ))}
        {invoices === undefined ? <ListSkeleton size="sm" rows={3} /> : upcoming.length === 0 && <EmptyState size="sm" message={t.no_payments_due_soon} />}
      </div>
    </WidgetShell>
  );
}

// ── Invoice aging ──

const AGING_BRACKETS = ["0-30", "31-60", "61-90", "90+"];

export function InvoiceAging() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: qk.dashboard.invoiceAging, queryFn: getInvoiceAging });

  const chartData = useMemo(() => {
    return AGING_BRACKETS.map((bracket) => {
      const row = data?.find((r) => r.bracket === bracket);
      return { bracket, count: row?.count ?? 0, total: row?.total ?? 0 };
    });
  }, [data]);

  const hasData = chartData.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <WidgetShell>
        <WidgetTitle>{t.invoice_aging}</WidgetTitle>
        {data === undefined ? <ListSkeleton size="sm" rows={3} /> : <EmptyState size="sm" message={t.no_outstanding_invoices} className="flex-1" />}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell>
      <WidgetTitle>{t.invoice_aging}</WidgetTitle>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis dataKey="bracket" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} unit="d" />
            <YAxis tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={chart.tooltipStyle}
              cursor={{ fill: chart.cursorFill }}
              formatter={(value, name) => {
                if (name === "count") return [String(value), t.invoices_count_plural];
                return [formatMoney(Number(value ?? 0), "CHF"), t.total];
              }}
            />
            <Bar dataKey="count" fill="var(--color-chart-4)" radius={[4, 4, 0, 0]} name="count" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 space-y-1">
        {chartData.filter((d) => d.count > 0).map((d) => (
          <div key={d.bracket} className="flex items-center justify-between text-xs">
            <span className="text-muted">{d.bracket}d</span>
            <span className="font-medium text-danger-text">{d.count} — {formatMoney(d.total, "CHF")}</span>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
