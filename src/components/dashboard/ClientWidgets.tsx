import { useMemo } from "react";
import { StatTile } from "../ui/StatTile";
import { useRevenueByClient } from "../../db/hooks/useFinance";
import { useInvoices } from "../../db/hooks/useInvoices";
import { useClients } from "../../db/hooks/useClients";
import { toLocalISO } from "../../utils/localDate";
import { useT } from "../../i18n/useT";
import { useDashboardYear } from "./DashboardYearContext";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { KPI_TILE, formatCHF } from "./widgetParts";

// ── Phase 18: Top client ──

export function TopClient() {
  const year = useDashboardYear();
  const { data: rows } = useRevenueByClient(year);
  const t = useT();

  const top = rows?.[0];

  return (
    <StatTile
      className={KPI_TILE}
      label={t.top_client}
      value={top ? top.label : (
        <span className="text-sm font-normal text-muted">{rows === undefined ? "…" : t.no_revenue_in_year.replace("{year}", String(year))}</span>
      )}
      caption={top && formatCHF(top.total)}
    />
  );
}

// ── Phase 18: Client activity ──

export function ClientActivity() {
  const { data: clients } = useClients();
  const { data: invoices } = useInvoices();
  const t = useT();

  const { active, dormant } = useMemo(() => {
    if (!clients || !invoices) return { active: [], dormant: [] };
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = toLocalISO(threeMonthsAgo);

    const lastInvoice: Record<string, string> = {};
    for (const inv of invoices) {
      if (!lastInvoice[inv.client_id] || inv.invoice_date > lastInvoice[inv.client_id]) {
        lastInvoice[inv.client_id] = inv.invoice_date;
      }
    }

    const active: { name: string; lastDate: string }[] = [];
    const dormant: { name: string; lastDate: string }[] = [];
    for (const c of clients) {
      const last = lastInvoice[c.id];
      if (!last || last < cutoff) {
        dormant.push({ name: c.name, lastDate: last ?? "" });
      } else {
        active.push({ name: c.name, lastDate: last });
      }
    }
    return { active: active.sort((a, b) => b.lastDate.localeCompare(a.lastDate)), dormant };
  }, [clients, invoices]);

  return (
    <WidgetShell>
      <WidgetTitle>{t.client_activity}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {active.slice(0, 5).map((c) => (
          <div key={c.name} className="flex items-center justify-between text-sm px-2 py-1 -mx-2">
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-success-text shrink-0 ml-2">{t.active_clients}</span>
          </div>
        ))}
        {dormant.map((c) => (
          <div key={c.name} className="flex items-center justify-between text-sm px-2 py-1 -mx-2 opacity-60">
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-warning-text shrink-0 ml-2">{t.dormant}</span>
          </div>
        ))}
        {clients === undefined || invoices === undefined ? <ListSkeleton size="sm" rows={3} /> : active.length === 0 && dormant.length === 0 && <EmptyState size="sm" message={t.no_clients} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: New clients this year ──

export function NewClientsYear() {
  const { data: clients } = useClients();
  const t = useT();
  const year = useDashboardYear();

  const count = useMemo(() => {
    if (!clients) return 0;
    return clients.filter((c) => c.created_at?.startsWith(String(year))).length;
  }, [clients, year]);

  return (
    <StatTile className={KPI_TILE} label={t.new_clients_year} value={count} caption={t.new_this_year} />
  );
}
