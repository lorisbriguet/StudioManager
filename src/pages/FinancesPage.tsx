import { useState } from "react";
import { Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { createElement } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, mkdir, copyFile } from "@tauri-apps/plugin-fs";
import { pdf } from "@react-pdf/renderer";
import { toast } from "sonner";
import { usePLData, useMonthlyData } from "../db/hooks/useFinance";
import { useInvoices } from "../db/hooks/useInvoices";
import { useExpenses } from "../db/hooks/useExpenses";
import { useClients } from "../db/hooks/useClients";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
import { getInvoiceLineItems } from "../db/queries/invoices";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { PLPDF } from "../components/finance/PLPDF";
import { InvoicesListPDF } from "../components/finance/InvoicesListPDF";
import { ExpensesListPDF } from "../components/finance/ExpensesListPDF";
import { getMonthlyData } from "../db/queries/finance";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PIE_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626"];

export function FinancesPage() {
  const t = useT();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: pl, isLoading } = usePLData(year);
  const { data: monthly } = useMonthlyData(year);
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: clients } = useClients();
  const { data: profile } = useBusinessProfile();
  const dark = useAppStore((s) => s.darkMode);
  const exportLang = useAppStore((s) => s.exportLanguage);

  const exportForTrustee = async () => {
    try {
      const basePath = await save({
        title: `Export comptable ${year}`,
        defaultPath: `Comptabilite_${year}`,
      });
      if (!basePath) return;

      await mkdir(basePath, { recursive: true });
      await mkdir(`${basePath}/factures`, { recursive: true });
      await mkdir(`${basePath}/factures/justificatifs`, { recursive: true });
      await mkdir(`${basePath}/depenses`, { recursive: true });
      await mkdir(`${basePath}/depenses/justificatifs`, { recursive: true });

      // Export P&L as PDF
      if (pl && profile) {
        const monthlyData = await getMonthlyData(year);
        const plDoc = createElement(PLPDF, { year, pl, monthly: monthlyData, profile, lang: exportLang });
        const plBlob = await pdf(plDoc as never).toBlob();
        const plBytes = new Uint8Array(await plBlob.arrayBuffer());
        await writeFile(`${basePath}/${profile.owner_name.toUpperCase()} - ${year} - Comptabilite.pdf`, plBytes);
      }

      // Export invoices list PDF + individual invoice PDFs
      const yearInvoices = invoices?.filter((inv) => inv.invoice_date.startsWith(String(year))) ?? [];
      const clientNames: Record<string, string> = {};
      for (const c of clients ?? []) clientNames[c.id] = c.name;

      if (profile) {
        // Invoices summary PDF
        const invListDoc = createElement(InvoicesListPDF, { year, invoices: yearInvoices, clientNames, profile, lang: exportLang });
        const invListBlob = await pdf(invListDoc as never).toBlob();
        await writeFile(`${basePath}/factures/factures_${year}.pdf`, new Uint8Array(await invListBlob.arrayBuffer()));
      }

      // Individual invoice PDFs
      for (const inv of yearInvoices) {
        try {
          const client = clients?.find((c) => c.id === inv.client_id);
          if (client && profile) {
            const lineItems = await getInvoiceLineItems(inv.id);
            const doc = createElement(InvoicePDF, { invoice: inv, lineItems, client, profile });
            const blob = await pdf(doc as never).toBlob();
            await writeFile(`${basePath}/factures/justificatifs/${inv.reference}_${client.name}.pdf`, new Uint8Array(await blob.arrayBuffer()));
          }
        } catch {
          // PDF generation may fail for some invoices
        }
      }

      // Export expenses list PDF + copy receipts
      const yearExpenses = expenses?.filter((exp) => exp.invoice_date.startsWith(String(year))) ?? [];

      if (profile) {
        const expListDoc = createElement(ExpensesListPDF, { year, expenses: yearExpenses, profile, lang: exportLang });
        const expListBlob = await pdf(expListDoc as never).toBlob();
        await writeFile(`${basePath}/depenses/depenses_${year}.pdf`, new Uint8Array(await expListBlob.arrayBuffer()));
      }

      for (const exp of yearExpenses) {
        if (exp.receipt_path) {
          try {
            const ext = exp.receipt_path.split(".").pop() ?? "pdf";
            await copyFile(exp.receipt_path, `${basePath}/depenses/justificatifs/${exp.reference}_${exp.supplier}.${ext}`);
          } catch {
            // receipt file may not exist
          }
        }
      }

      toast.success(`Exported to ${basePath}`);
    } catch {
      toast.error("Export failed");
    }
  };

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  const chartData = monthly?.map((m, i) => ({
    name: MONTHS[i],
    revenue: m.revenue,
    expenses: m.expenses,
  })) ?? [];

  const pieData = pl?.operating_expenses
    .filter((c) => c.total > 0)
    .map((c) => ({ name: c.category_code, value: c.total, label: c.name_fr })) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t.finances}</h1>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-md px-3 py-1.5 text-sm"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={exportForTrustee}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
          >
            <Download size={14} /> {t.export_trustee}
          </button>
        </div>
      </div>

      {/* Monthly revenue vs expenses chart */}
      <div className="border border-gray-200 rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium mb-4">{t.revenue_vs_expenses}</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#2d2d2d" : "#f0f0f0"} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: dark ? "#a3a3a3" : undefined }} />
            <YAxis tick={{ fontSize: 11, fill: dark ? "#a3a3a3" : undefined }} />
            <Tooltip
              formatter={(value) => [`CHF ${Number(value ?? 0).toFixed(2)}`, ""]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid", borderColor: dark ? "#2d2d2d" : "#e5e5e5", backgroundColor: dark ? "#1e1e1e" : "#fff", color: dark ? "#e5e5e5" : undefined }}
              cursor={{ fill: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }}
            />
            <Bar dataKey="revenue" fill="#16a34a" radius={[3, 3, 0, 0]} name="Revenue" />
            <Bar dataKey="expenses" fill="#dc2626" radius={[3, 3, 0, 0]} name="Expenses" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Expense breakdown pie chart */}
        {pieData.length > 0 && (
          <div className="border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-medium mb-4">{t.expense_breakdown}</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, _, entry) => [
                    `CHF ${Number(value ?? 0).toFixed(2)}`,
                    (entry as { payload: { label: string } }).payload.label,
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid", borderColor: dark ? "#2d2d2d" : "#e5e5e5", backgroundColor: dark ? "#1e1e1e" : "#fff", color: dark ? "#e5e5e5" : undefined }}
                  itemStyle={dark ? { color: "#e5e5e5" } : undefined}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {pieData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-muted">{d.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* P&L statement */}
        {pl && (
          <div className="border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-medium mb-4">{t.profit_loss}</h2>
            <div className="space-y-1">
              <PLLine label={t.revenue} value={pl.revenue} bold />

              {pl.operating_expenses.map((cat) => (
                <PLLine
                  key={cat.category_code}
                  label={`${cat.category_code} - ${cat.name_fr}`}
                  value={-cat.total}
                  negative
                />
              ))}
              <PLLine
                label={t.total_operating}
                value={-pl.total_operating}
                negative
                bold
                border
              />
              <PLLine label={t.operating_net} value={pl.operating_net} bold />
              <PLLine label={t.social_charges} value={-pl.social_charges} negative />

              <div className="border-t-2 border-gray-900 mt-2 pt-2">
                <PLLine label={t.net_result} value={pl.net_result} bold large />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PLLine({
  label,
  value,
  bold,
  negative,
  border,
  large,
}: {
  label: string;
  value: number;
  bold?: boolean;
  negative?: boolean;
  border?: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-1 ${
        border ? "border-t border-gray-200 pt-2" : ""
      }`}
    >
      <span className={`text-xs ${bold ? "font-semibold" : "text-muted"}`}>
        {label}
      </span>
      <span
        className={`${large ? "text-sm" : "text-xs"} ${bold ? "font-semibold" : ""} ${
          negative && value < 0 ? "text-danger" : ""
        }`}
      >
        {value < 0 ? "- " : ""}CHF {Math.abs(value).toLocaleString("de-CH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </div>
  );
}
