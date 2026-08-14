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

// OCR/PDF extraction pulls in tesseract.js and pdfjs; irrelevant here.
vi.mock("../lib/pdfExtract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
  isOcrWorkerReady: vi.fn(() => false),
}));

// Enter-to-save bug: the "Edit paid date" modal only saved via the Save
// button; pressing Enter in the date input did nothing.

const YEAR = new Date().getFullYear();

const expense = {
  id: 1,
  reference: "EXP-0001",
  supplier: "ACME",
  category_code: "FA",
  invoice_date: `${YEAR}-01-10`,
  due_date: null,
  amount: 42,
  paid_date: `${YEAR}-01-15`,
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

describe("Edit paid date modal", () => {
  it("saves on Enter in the date input and closes the modal", async () => {
    const { container } = renderPage();
    const row = (await screen.findByText("ACME")).closest("tr")!;
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /edit paid date/i }));

    const input = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: `${YEAR}-02-01` } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const upd = executedStatements.find((s) => s.sql.includes("UPDATE expenses"));
      expect(upd).toBeDefined();
      expect(upd!.params).toContain(`${YEAR}-02-01`);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
