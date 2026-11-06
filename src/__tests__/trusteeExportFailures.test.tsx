import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { notify } from "../lib/notify";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, mkdir, copyFile } from "@tauri-apps/plugin-fs";
import { FinancesPage } from "../pages/FinancesPage";
import { useAppStore } from "../stores/app-store";

// One bad invoice's PDF must not abort the whole trustee export — the export
// still has to complete (other PDFs written, success toast shown) AND the
// omission must be reported, not swallowed by an empty catch.

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
}));

vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));

// plugin-dialog and plugin-fs both alias to the same catch-all mock module
// (see vitest.config.ts), so ONE vi.mock must supply every export either
// specifier's real code imports — FinancesPage pulls `save` from the
// dialog plugin and `writeFile`/`mkdir`/`copyFile` from the fs plugin.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  copyFile: vi.fn(),
}));

// These components call StyleSheet.create() at module load time, so even
// though pdf() below never actually renders them, importing the real
// modules would still execute against the mocked @react-pdf/renderer.
vi.mock("../components/invoice/InvoicePDF", () => ({ InvoicePDF: () => null }));
vi.mock("../components/finance/PLPDF", () => ({ PLPDF: () => null }));
vi.mock("../components/finance/InvoicesListPDF", () => ({ InvoicesListPDF: () => null }));
vi.mock("../components/finance/ExpensesListPDF", () => ({ ExpensesListPDF: () => null }));
vi.mock("../components/finance/IncomeListPDF", () => ({ IncomeListPDF: () => null }));

vi.mock("@react-pdf/renderer", () => ({
  pdf: () => ({
    toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
  }),
}));

const YEAR = new Date().getFullYear();

const pl = {
  revenue: 1000,
  invoice_revenue: 1000,
  other_income: 0,
  operating_expenses: [],
  total_operating: 0,
  social_charges: 0,
  social_charge_categories: [],
  operating_net: 1000,
  net_result: 1000,
};
const profile = { id: 1, owner_name: "Loris Briguet" };
const client = { id: "c1", name: "ACME" };
const slashClient = { id: "c2", name: "Migros/Coop" };
const goodInvoice = {
  id: 1,
  reference: "2026-0001",
  client_id: "c1",
  invoice_date: `${YEAR}-01-15`,
  status: "sent",
  currency: "CHF",
  chf_equivalent: 0,
  total: 500,
};
const badInvoice = {
  id: 2,
  reference: "2026-0002",
  client_id: "c1",
  invoice_date: `${YEAR}-02-15`,
  status: "sent",
  currency: "CHF",
  chf_equivalent: 0,
  total: 500,
};

vi.mock("../db/hooks/useFinance", () => ({
  usePLData: () => ({ data: pl, isLoading: false }),
  useMonthlyData: () => ({ data: [] }),
}));
// Each test sets the rows the hooks return.
const data = vi.hoisted(() => ({
  invoices: [] as unknown[],
  expenses: [] as unknown[],
  incomes: [] as unknown[],
}));
vi.mock("../db/hooks/useInvoices", () => ({
  useInvoices: () => ({ data: data.invoices }),
}));
vi.mock("../db/hooks/useExpenses", () => ({
  useExpenses: () => ({ data: data.expenses }),
}));
vi.mock("../db/hooks/useIncome", () => ({
  useIncomes: () => ({ data: data.incomes }),
}));
vi.mock("../db/hooks/useClients", () => ({
  useClients: () => ({ data: [client, slashClient] }),
}));
vi.mock("../db/hooks/useBusinessProfile", () => ({
  useBusinessProfile: () => ({ data: profile }),
}));
vi.mock("../db/queries/finance", () => ({
  getMonthlyData: async () => [],
}));
// Each invoice PDF goes through the shared builder; the bad invoice's id
// decides which one fails.
const buildInvoicePdf = vi.hoisted(() => vi.fn());
vi.mock("../lib/documentPdf", () => ({ buildInvoicePdf }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FinancesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  vi.mocked(save).mockReset().mockResolvedValue("/export/path");
  vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
  vi.mocked(copyFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(notify.warning).mockReset();
  vi.mocked(notify.success).mockReset();
  data.invoices = [goodInvoice, badInvoice];
  data.expenses = [];
  data.incomes = [];
  buildInvoicePdf.mockReset().mockImplementation(async (id: number) => {
    if (id === badInvoice.id) throw new Error("PDF generation failed");
    const inv = (data.invoices as { id: number; client_id: string; reference: string }[]).find((i) => i.id === id)!;
    const c = inv.client_id === slashClient.id ? slashClient : client;
    return { bytes: new Uint8Array([1, 2, 3]), invoice: inv, client: c, reference: inv.reference };
  });
});

async function runExport() {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /export for trustee/i }));
  await waitFor(() => expect(notify.success).toHaveBeenCalled());
}

const written = () => vi.mocked(writeFile).mock.calls.map((c: unknown[]) => String(c[0]));
const copied = () => vi.mocked(copyFile).mock.calls.map((c: unknown[]) => [String(c[0]), String(c[1])]);

afterEach(() => {
  cleanup();
});

describe("exportForTrustee", () => {
  it("continues past a failed invoice PDF and warns with the failure count", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /export for trustee/i }));

    await waitFor(() => {
      expect(notify.warning).toHaveBeenCalledWith(
        "1 invoice PDFs couldn't be generated and are missing from the export"
      );
    });

    // The export still completes: the good invoice's PDF is written and a
    // success toast fires, instead of the whole export aborting silently.
    const writtenPaths = vi.mocked(writeFile).mock.calls.map((c: unknown[]) => String(c[0]));
    expect(writtenPaths.some((p: string) => p.includes("2026-0001_ACME.pdf"))).toBe(true);
    expect(writtenPaths.some((p: string) => p.includes("2026-0002_ACME.pdf"))).toBe(false);
    expect(notify.success).toHaveBeenCalled();
  });

  it("copies the stored invoice PDF instead of rendering it again", async () => {
    data.invoices = [{ ...goodInvoice, pdf_path: "/data/invoices/2026-0001_ACME.pdf" }];
    await runExport();

    expect(copied()).toContainEqual([
      "/data/invoices/2026-0001_ACME.pdf",
      "/export/path/factures/justificatifs/2026-0001_ACME.pdf",
    ]);
    expect(buildInvoicePdf).not.toHaveBeenCalled();
    expect(written().some((p) => p.includes("justificatifs/2026-0001"))).toBe(false);
  });

  it("renders the invoice when its stored PDF can't be copied", async () => {
    data.invoices = [{ ...goodInvoice, pdf_path: "/gone.pdf" }];
    vi.mocked(copyFile).mockRejectedValueOnce(new Error("not found"));
    await runExport();

    expect(buildInvoicePdf).toHaveBeenCalledWith(goodInvoice.id);
    expect(written()).toContain("/export/path/factures/justificatifs/2026-0001_ACME.pdf");
    expect(notify.warning).not.toHaveBeenCalled();
  });

  it("writes the file when the client name contains a slash", async () => {
    data.invoices = [
      { ...goodInvoice, client_id: slashClient.id },
      { ...goodInvoice, id: 3, client_id: slashClient.id, pdf_path: "/data/invoices/x.pdf" },
    ];
    await runExport();

    // Both share a reference and client: the second gets a suffix, not an overwrite.
    expect(written()).toContain("/export/path/factures/justificatifs/2026-0001_Migros_Coop.pdf");
    expect(copied()).toContainEqual([
      "/data/invoices/x.pdf",
      "/export/path/factures/justificatifs/2026-0001_Migros_Coop_2.pdf",
    ]);
    expect(notify.warning).not.toHaveBeenCalled();
  });

  it("names expense receipts safely and doesn't overwrite duplicates", async () => {
    data.expenses = [
      { id: 1, reference: "D-26-001", supplier: "A/B", invoice_date: `${YEAR}-03-01`, receipt_path: "/r/one.jpg" },
      { id: 2, reference: "D-26-001", supplier: "A/B", invoice_date: `${YEAR}-03-02`, receipt_path: "/r/two.JPG" },
      { id: 3, reference: "D-26-001", supplier: "A/B", invoice_date: `${YEAR}-03-03`, receipt_path: "/r.dir/three" },
    ];
    await runExport();

    expect(copied()).toEqual([
      ["/r/one.jpg", "/export/path/depenses/justificatifs/D-26-001_A_B.jpg"],
      ["/r/two.JPG", "/export/path/depenses/justificatifs/D-26-001_A_B_2.JPG"],
      // No extension in the file name (only in a folder name): falls back to .pdf
      ["/r.dir/three", "/export/path/depenses/justificatifs/D-26-001_A_B.pdf"],
    ]);
  });

  it("exports the year's other income as a list PDF with its receipts", async () => {
    data.incomes = [
      { id: 1, reference: "R-26-001", date: `${YEAR}-04-01`, source: "HEAD Genève", amount: 1200, category: "side_income", receipt_path: "/r/head.pdf" },
      { id: 2, reference: "R-26-002", date: `${YEAR}-05-01`, source: "Bank", amount: 3, category: "interest", receipt_path: null },
      { id: 3, reference: "R-25-009", date: `${YEAR - 1}-12-01`, source: "Old", amount: 50, category: "other", receipt_path: "/r/old.pdf" },
    ];
    await runExport();

    expect(written()).toContain(`/export/path/revenus/revenus_${YEAR}.pdf`);
    expect(copied()).toEqual([["/r/head.pdf", "/export/path/revenus/justificatifs/R-26-001_HEAD Genève.pdf"]]);
    expect(vi.mocked(mkdir).mock.calls.map((c: unknown[]) => String(c[0]))).toContain("/export/path/revenus/justificatifs");
  });
});
