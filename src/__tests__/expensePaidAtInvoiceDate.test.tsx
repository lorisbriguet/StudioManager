import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExpensesPage } from "../pages/ExpensesPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Receipt OCR/PDF extraction is irrelevant here.
vi.mock("../lib/pdfExtract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
}));

// QoL: expenses paid on the spot shouldn't need the edit-date modal —
// one context-menu click sets paid_date to the expense's invoice_date.

const YEAR = new Date().getFullYear();

const expense = {
  id: 1,
  reference: "EXP-0001",
  supplier: "ACME",
  category_code: "FA",
  invoice_date: `${YEAR}-01-10`,
  due_date: null,
  amount: 42,
  paid_date: null,
  receipt_path: null,
  notes: "",
  created_at: "",
  updated_at: "",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExpensesPage />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("DISTINCT supplier")) return [{ supplier: "ACME" }];
    if (flat.includes("FROM expenses")) return [expense];
    if (flat.includes("FROM expense_categories")) {
      return [
        { code: "FA", name_fr: "Frais administratifs", name_en: "Admin fees", pl_section: "operating", color: null },
      ];
    }
    return [];
  });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("mark as paid at invoice date", () => {
  it("sets paid_date to the expense's invoice date from the context menu", async () => {
    renderPage();
    const row = (await screen.findByText("ACME")).closest("tr")!;
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /paid at invoice date/i }));

    await waitFor(() => {
      const upd = executedStatements.find((s) => s.sql.includes("UPDATE expenses"));
      expect(upd).toBeDefined();
      expect(upd!.params).toContain(`${YEAR}-01-10`);
    });
  });
});
