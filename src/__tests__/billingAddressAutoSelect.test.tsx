import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoiceFormPage } from "../pages/InvoiceFormPage";
import { QuoteFormPage } from "../pages/QuoteFormPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";

// D5 follow-up: on an existing document stored without a billing address,
// the form filled in the client's only address on its own, so it showed an
// address the database didn't hold (and an undo seemed to lose it). Only a
// new document, or a client picked by hand, gets the address filled in.

const YEAR = new Date().getFullYear();
const common = {
  id: 7,
  reference: "DRAFT-7",
  client_id: "C-002",
  project_id: null,
  contact_id: null,
  billing_address_id: null,
  template_id: null,
  status: "draft",
  language: "FR",
  activity: "Graphisme",
  activity_id: null,
  assignment: "",
  subtotal: 0,
  discount_applied: 0,
  discount_rate: 0,
  discount_label: "",
  total: 0,
  notes: "",
  currency: "CHF",
  exchange_rate: 1,
  chf_equivalent: 0,
};
const invoiceRow = {
  ...common,
  invoice_date: `${YEAR}-02-01`,
  due_date: `${YEAR}-03-01`,
  payment_terms_days: 30,
  po_number: null,
  paid_date: null,
  pdf_path: null,
  from_quote_id: null,
  reminder_count: 0,
  last_reminder_date: null,
};
const quoteRow = { ...common, quote_date: `${YEAR}-02-01`, valid_until: `${YEAR}-03-01` };

const clients = [
  { id: "C-001", name: "Atelier Noir", language: "FR", has_discount: 0, discount_rate: 0 },
  { id: "C-002", name: "Fondation Artvis", language: "FR", has_discount: 1, discount_rate: 0.1 },
];
const address = {
  id: 3,
  client_id: "C-002",
  label: "Foundation",
  billing_name: "Fondation Artvis",
  address_line1: "Quai du Mont-Blanc 7",
  address_line2: "",
  postal_city: "1201 Genève",
};

function mount(path: string, route: string, element: React.ReactElement) {
  setSelectHandler((sql, params) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM client_addresses")) return params?.[0] === "C-002" ? [address] : [];
    if (flat.includes("FROM invoices")) return [invoiceRow];
    if (flat.includes("FROM quotes")) return [quoteRow];
    if (flat.includes("FROM clients")) return clients;
    if (flat.includes("FROM business_profile")) return [{ id: 1, owner_name: "Studio", default_payment_terms_days: 30 }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
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

const forms = [
  ["invoice", "/invoices", <InvoiceFormPage />],
  ["quote", "/quotes", <QuoteFormPage />],
] as const;

describe.each(forms)("%s form billing address", (_name, base, element) => {
  it("an existing document shows the address it is stored with", async () => {
    mount(`${base}/7/edit`, `${base}/:id/edit`, element);
    const select = await screen.findByLabelText(/billing address/i);
    // Let the address list load: an auto-select would happen then
    await waitFor(() => expect(screen.getByLabelText(/client/i)).toHaveTextContent("Fondation Artvis"));
    await new Promise((r) => setTimeout(r, 50));
    expect(select).toHaveTextContent("Main address");
  });

  it("picking a client with one address fills it in", async () => {
    mount(`${base}/new`, `${base}/new`, element);
    fireEvent.click(await screen.findByLabelText(/client/i));
    fireEvent.click(await screen.findByRole("option", { name: "Fondation Artvis" }));
    await waitFor(() =>
      expect(screen.getByLabelText(/billing address/i)).toHaveTextContent("Foundation — Fondation Artvis")
    );
  });
});
