import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewExpenseForm } from "../pages/ExpensesPage";
import { NewIncomeForm } from "../pages/IncomePage";
import { useAppStore } from "../stores/app-store";

vi.mock("../lib/pdfExtract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
}));

// OCR-prefilled fields must be visibly marked ("From receipt") with a
// one-click clear, and the marker must vanish once the user edits the field.

const CATS = [{ code: "FA", name_fr: "Frais administratifs" }];

function renderForm(prefill: { supplier?: string; amount?: number; invoice_date?: string } | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewExpenseForm
        categories={CATS}
        pastSuppliers={[]}
        prefill={prefill}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
});

afterEach(cleanup);

describe("detected-from-receipt indicators", () => {
  it("marks each OCR-prefilled field", () => {
    renderForm({ supplier: "ACME", amount: 12.5, invoice_date: "2026-01-05" });
    expect(screen.getAllByText(/from receipt/i)).toHaveLength(3);
  });

  it("shows no indicators without a prefill", () => {
    renderForm(null);
    expect(screen.queryByText(/from receipt/i)).not.toBeInTheDocument();
  });

  it("removes the indicator when the user edits the field", () => {
    renderForm({ supplier: "ACME", amount: 12.5, invoice_date: "2026-01-05" });
    const supplier = screen.getByDisplayValue("ACME");
    fireEvent.change(supplier, { target: { value: "ACME SA" } });
    expect(screen.getAllByText(/from receipt/i)).toHaveLength(2);
  });

  it("clears the field value via the indicator's clear button", () => {
    renderForm({ supplier: "ACME", amount: 12.5, invoice_date: "2026-01-05" });
    const clearButtons = screen.getAllByLabelText(/clear detected/i);
    fireEvent.click(clearButtons[0]); // supplier badge
    expect(screen.queryByDisplayValue("ACME")).not.toBeInTheDocument();
    expect(screen.getAllByText(/from receipt/i)).toHaveLength(2);
  });
});

describe("detected-from-receipt indicators (income)", () => {
  function renderIncomeForm(prefill: { source?: string; amount?: number; date?: string } | null) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <NewIncomeForm
          droppedReceiptPath={null}
          prefill={prefill}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>
    );
  }

  it("marks prefilled fields and clears the marker on edit", () => {
    renderIncomeForm({ source: "ACME", amount: 99, date: "2026-01-05" });
    expect(screen.getAllByText(/from receipt/i)).toHaveLength(3);
    fireEvent.change(screen.getByDisplayValue("ACME"), { target: { value: "Other" } });
    expect(screen.getAllByText(/from receipt/i)).toHaveLength(2);
  });
});
