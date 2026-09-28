import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { toast } from "sonner";
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

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
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

// The bad invoice's own reference is used to decide which render fails.
vi.mock("@react-pdf/renderer", () => ({
  pdf: (doc: { props?: { invoice?: { reference?: string } } }) => ({
    toBlob: async () => {
      if (doc?.props?.invoice?.reference === "2026-0002") {
        throw new Error("PDF generation failed");
      }
      return new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" });
    },
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
vi.mock("../db/hooks/useInvoices", () => ({
  useInvoices: () => ({ data: [goodInvoice, badInvoice] }),
}));
vi.mock("../db/hooks/useExpenses", () => ({
  useExpenses: () => ({ data: [] }),
}));
vi.mock("../db/hooks/useClients", () => ({
  useClients: () => ({ data: [client] }),
}));
vi.mock("../db/hooks/useBusinessProfile", () => ({
  useBusinessProfile: () => ({ data: profile }),
}));
vi.mock("../db/queries/finance", () => ({
  getMonthlyData: async () => [],
}));
vi.mock("../db/queries/invoices", () => ({
  getLineItemsForInvoices: async () => new Map(),
}));

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
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.success).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("exportForTrustee", () => {
  it("continues past a failed invoice PDF and warns with the failure count", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /export for trustee/i }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        "1 invoice PDFs could not be generated and are missing from the export."
      );
    });

    // The export still completes: the good invoice's PDF is written and a
    // success toast fires, instead of the whole export aborting silently.
    const writtenPaths = vi.mocked(writeFile).mock.calls.map((c: unknown[]) => String(c[0]));
    expect(writtenPaths.some((p: string) => p.includes("2026-0001_ACME.pdf"))).toBe(true);
    expect(writtenPaths.some((p: string) => p.includes("2026-0002_ACME.pdf"))).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });
});
