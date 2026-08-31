import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoiceFormPage } from "../pages/InvoiceFormPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// 340 — "Save & Preview" collapses the save > list > row menu > preview trip
// into one click on the form.

const YEAR = new Date().getFullYear();

const invoiceRow = {
  id: 7,
  reference: "2026-0007",
  client_id: "c1",
  project_id: null,
  contact_id: null,
  billing_address_id: null,
  template_id: null,
  status: "draft",
  language: "EN",
  activity: "Design",
  activity_id: null,
  assignment: "",
  invoice_date: `${YEAR}-02-01`,
  due_date: `${YEAR}-03-01`,
  payment_terms_days: 30,
  subtotal: 500,
  discount_applied: 0,
  discount_rate: 0,
  discount_label: "",
  total: 500,
  po_number: null,
  paid_date: null,
  pdf_path: null,
  from_quote_id: null,
  notes: "",
  currency: "CHF",
  exchange_rate: 1,
  chf_equivalent: 0,
  reminder_count: 0,
  last_reminder_date: null,
};

const lineItem = {
  id: 1,
  invoice_id: 7,
  designation: "Poster design",
  rate: 100,
  unit: "h",
  quantity: 5,
  amount: 500,
  sort_order: 0,
};

function renderForm() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM invoice_line_items")) return [lineItem];
    if (flat.includes("FROM invoices WHERE id")) return [invoiceRow];
    if (flat.includes("FROM invoices")) return [invoiceRow];
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME", language: "EN", has_discount: 0, discount_rate: 0 }];
    if (flat.includes("FROM business_profile")) return [{ id: 1, default_payment_terms_days: 30 }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/invoices/7/edit"]}>
        <Routes>
          <Route path="/invoices/:id/edit" element={<InvoiceFormPage />} />
          <Route path="/invoices/:id/preview" element={<div data-testid="preview-probe" />} />
          <Route path="/invoices" element={<div data-testid="list-probe" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("Invoice form Save & Preview", () => {
  it("saves and lands on the invoice preview", async () => {
    renderForm();
    // Wait for the loaded line item — save() validates line items.
    await screen.findByDisplayValue("Poster design");
    const btn = await screen.findByRole("button", { name: /save & preview/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId("preview-probe")).toBeInTheDocument();
    });
    const update = executedStatements.find((s) => s.sql.replace(/\s+/g, " ").includes("UPDATE invoices"));
    expect(update).toBeDefined();
  });

  it("plain save still returns to the list", async () => {
    renderForm();
    await screen.findByDisplayValue("Poster design");
    const btn = await screen.findByRole("button", { name: /update invoice/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId("list-probe")).toBeInTheDocument();
    });
  });
});
