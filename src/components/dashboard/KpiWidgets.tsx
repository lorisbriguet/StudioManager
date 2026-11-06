import { useMemo } from "react";
import { useCountUp } from "../../hooks/useCountUp";
import { StatTile } from "../ui/StatTile";
import { useDashboardKPIs } from "../../db/hooks/useFinance";
import { useInvoices } from "../../db/hooks/useInvoices";
import { useQuotes } from "../../db/hooks/useQuotes";
import { useT } from "../../i18n/useT";
import { yoyDelta } from "../../lib/yoyDelta";
import { useDashboardYear } from "./DashboardYearContext";
import { formatMoney } from "../../lib/money";
import { KPI_TILE, formatCHF } from "./widgetParts";

// ── KPI widgets ──

export function KPIWidget({ label, value, numericValue, accent, delta }: { label: string; value: string; numericValue?: number; accent?: boolean; delta?: number | null }) {
  const t = useT();
  const animated = useCountUp(numericValue ?? 0);
  const displayValue = numericValue != null
    ? formatMoney(animated, "CHF")
    : value;
  return (
    <StatTile
      className={KPI_TILE}
      label={label}
      value={displayValue}
      tone={accent ? "warning" : "default"}
      caption={delta != null && (
        <span className={`font-medium ${delta >= 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)]"}`}>
          {delta >= 0 ? "+" : ""}{delta}% {t.vs_last_year}
        </span>
      )}
    />
  );
}

export function KPIInvoiced() {
  const year = useDashboardYear();
  const { data: kpis } = useDashboardKPIs(year);
  const { data: prev } = useDashboardKPIs(year - 1);
  const t = useT();
  return (
    <KPIWidget
      label={t.total_invoiced}
      value={formatCHF(kpis?.total_invoiced ?? 0)}
      numericValue={kpis?.total_invoiced ?? 0}
      delta={prev ? yoyDelta(kpis?.total_invoiced ?? 0, prev.total_invoiced) : null}
    />
  );
}

export function KPIBalance() {
  const year = useDashboardYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();
  return <KPIWidget label={t.open_balance} value={formatCHF(kpis?.open_balance ?? 0)} numericValue={kpis?.open_balance ?? 0} accent={!!kpis?.open_balance} />;
}

export function KPIExpenses() {
  const year = useDashboardYear();
  const { data: kpis } = useDashboardKPIs(year);
  const { data: prev } = useDashboardKPIs(year - 1);
  const t = useT();
  return (
    <KPIWidget
      label={t.total_expenses}
      value={formatCHF(kpis?.total_expenses ?? 0)}
      numericValue={kpis?.total_expenses ?? 0}
      delta={prev ? yoyDelta(kpis?.total_expenses ?? 0, prev.total_expenses) : null}
    />
  );
}

export function KPINet() {
  const year = useDashboardYear();
  const { data: kpis } = useDashboardKPIs(year);
  const { data: prev } = useDashboardKPIs(year - 1);
  const t = useT();
  return (
    <KPIWidget
      label={t.net_result}
      value={formatCHF(kpis?.net_result ?? 0)}
      numericValue={kpis?.net_result ?? 0}
      delta={prev ? yoyDelta(kpis?.net_result ?? 0, prev.net_result) : null}
    />
  );
}

// ── Phase 18: Profit margin ──

export function ProfitMargin() {
  const year = useDashboardYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();

  const revenue = kpis?.total_invoiced ?? 0;
  const net = kpis?.net_result ?? 0;
  const margin = revenue > 0 ? Math.round((net / revenue) * 100) : 0;

  return (
    <StatTile
      className={KPI_TILE}
      label={t.profit_margin}
      value={`${margin}%`}
      tone={margin < 0 ? "danger" : margin < 20 ? "warning" : "success"}
      caption={<>{formatCHF(net)} / {formatCHF(revenue)}</>}
    />
  );
}

// ── Phase 18: Average invoice value ──

export function AverageInvoiceValue() {
  const { data: invoices } = useInvoices();
  const t = useT();
  const year = useDashboardYear();

  const avg = useMemo(() => {
    if (!invoices) return 0;
    const yearInvoices = invoices.filter((i) => i.status !== "cancelled" && i.invoice_date.startsWith(String(year)));
    if (yearInvoices.length === 0) return 0;
    return yearInvoices.reduce((s, i) => s + i.total, 0) / yearInvoices.length;
  }, [invoices, year]);

  return <KPIWidget label={t.avg_invoice_value} value={formatCHF(avg)} />;
}

// ── Phase 18: Quote conversion rate ──

export function QuoteConversionRate() {
  const { data: quotes } = useQuotes();
  const t = useT();

  const { rate, converted, total } = useMemo(() => {
    if (!quotes || quotes.length === 0) return { rate: 0, converted: 0, total: 0 };
    const converted = quotes.filter((q) => q.converted_to_invoice_id != null).length;
    return { rate: Math.round((converted / quotes.length) * 100), converted, total: quotes.length };
  }, [quotes]);

  return (
    <StatTile
      className={KPI_TILE}
      label={t.quote_conversion_rate}
      value={`${rate}%`}
      caption={<>{converted}/{total} {t.of_quotes_converted}</>}
    />
  );
}
