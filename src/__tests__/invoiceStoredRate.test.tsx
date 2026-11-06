import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoiceFormPage } from "../pages/InvoiceFormPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";
import * as exchangeRate from "../lib/exchangeRate";

// Editing an invoice in its stored currency keeps the exchange rate and the CHF
// equivalent it was issued with: they are historical facts, never today's rate.

const YEAR = new Date().getFullYear();

function invoiceRow(currency: string, rate: number, chf: number) {
  return {
    id: 7, reference: "2026-0007", client_id: "c1", project_id: null, contact_id: null,
    billing_address_id: null, template_id: null, status: "draft", language: "EN",
    activity: "Design", activity_id: null, assignment: "", invoice_date: `${YEAR}-02-01`,
    due_date: `${YEAR}-03-01`, payment_terms_days: 30, subtotal: 500, discount_applied: 0,
    discount_rate: 0, discount_label: "", total: 500, po_number: null, paid_date: null,
    pdf_path: null, from_quote_id: null, notes: "", currency, exchange_rate: rate,
    chf_equivalent: chf, reminder_count: 0, last_reminder_date: null,
  };
}

const lineItem = {
  id: 1, invoice_id: 7, designation: "Poster design", rate: 100, unit: "h",
  quantity: 5, amount: 500, sort_order: 0,
};

function renderForm(row: ReturnType<typeof invoiceRow>) {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM invoice_line_items")) return [lineItem];
    if (flat.includes("FROM invoices")) return [row];
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
          <Route path="/invoices" element={<div data-testid="list-probe" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function saveAndGetUpdate() {
  await screen.findByDisplayValue("Poster design");
  fireEvent.click(await screen.findByRole("button", { name: /update invoice/i }));
  await waitFor(() => expect(screen.getByTestId("list-probe")).toBeInTheDocument());
  const update = executedStatements.find((s) => /UPDATE invoices SET/.test(s.sql.replace(/\s+/g, " ")));
  expect(update).toBeDefined();
  return update!.params;
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  vi.restoreAllMocks();
  cleanup();
});

describe("editing an invoice keeps its stored money facts", () => {
  it("a EUR invoice keeps its stored rate and CHF equivalent, without fetching a rate", async () => {
    const fetchRate = vi.spyOn(exchangeRate, "getExchangeRate");
    renderForm(invoiceRow("EUR", 0.93, 465));
    const params = await saveAndGetUpdate();
    expect(params).toContain(0.93);
    expect(params).toContain(465);
    expect(fetchRate).not.toHaveBeenCalled();
  });

  it("a CHF invoice books its total as the CHF equivalent", async () => {
    renderForm(invoiceRow("CHF", 1, 0));
    const params = await saveAndGetUpdate();
    expect(params).toContain(500);
  });
});
