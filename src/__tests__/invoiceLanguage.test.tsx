import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoiceFormPage } from "../pages/InvoiceFormPage";
import { QuoteFormPage } from "../pages/QuoteFormPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";

// U3: each invoice and quote has its own language (FR/EN). It defaults to the
// client's language, keeps the stored value on edit, and "New invoice" or
// "New quote" on a project page prefills client, project and language.

const CLIENTS = [
  { id: "C-001", name: "Atelier Noir", language: "FR", has_discount: 0, discount_rate: 0 },
  { id: "C-002", name: "Gallery North", language: "EN", has_discount: 1, discount_rate: 0.1 },
];

function mount(entry: string, element: React.ReactElement) {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM clients")) return CLIENTS;
    if (flat.includes("FROM projects")) {
      return [{ id: 7, client_id: "C-002", name: "Spring show", status: "active" }];
    }
    if (flat.includes("FROM invoices")) {
      return [{
        id: 1, reference: "DRAFT-1", client_id: "C-001", project_id: null, status: "draft",
        language: "EN", activity: "", assignment: "", invoice_date: "2026-11-01", notes: "",
        currency: "CHF", exchange_rate: 1, total: 0, chf_equivalent: 0, discount_rate: 0,
      }];
    }
    if (flat.includes("FROM business_profile")) return [{ id: 1, owner_name: "Studio" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/invoices/new" element={element} />
          <Route path="/invoices/:id/edit" element={element} />
          <Route path="/quotes/new" element={element} />
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

describe("per-document language", () => {
  it("new invoice from a project prefills client, project and the client's language", async () => {
    mount("/invoices/new?project=7", <InvoiceFormPage />);
    await waitFor(() => expect(screen.getByLabelText(/client/i)).toHaveTextContent("Gallery North"));
    await waitFor(() => expect(screen.getByLabelText(/project/i)).toHaveTextContent("Spring show"));
    expect(screen.getByLabelText(/^language/i)).toHaveTextContent("English");
  });

  it("picking a client sets the language, which can then be changed", async () => {
    mount("/invoices/new", <InvoiceFormPage />);
    fireEvent.click(await screen.findByLabelText(/client/i));
    fireEvent.click(await screen.findByRole("option", { name: "Gallery North" }));
    expect(screen.getByLabelText(/^language/i)).toHaveTextContent("English");
    fireEvent.click(screen.getByLabelText(/^language/i));
    fireEvent.click(await screen.findByRole("option", { name: "French" }));
    expect(screen.getByLabelText(/^language/i)).toHaveTextContent("French");
  });

  it("editing keeps the invoice's stored language, not the client's", async () => {
    mount("/invoices/1/edit", <InvoiceFormPage />);
    await waitFor(() => expect(screen.getByLabelText(/client/i)).toHaveTextContent("Atelier Noir"));
    expect(screen.getByLabelText(/^language/i)).toHaveTextContent("English");
  });

  it("new quote from a project prefills client, project and the client's language", async () => {
    mount("/quotes/new?project=7", <QuoteFormPage />);
    await waitFor(() => expect(screen.getByLabelText(/client/i)).toHaveTextContent("Gallery North"));
    await waitFor(() => expect(screen.getByLabelText(/project/i)).toHaveTextContent("Spring show"));
    expect(screen.getByLabelText(/^language/i)).toHaveTextContent("English");
  });

  it("new quote takes the picked client's language", async () => {
    mount("/quotes/new", <QuoteFormPage />);
    fireEvent.click(await screen.findByLabelText(/client/i));
    fireEvent.click(await screen.findByRole("option", { name: "Gallery North" }));
    expect(screen.getByLabelText(/^language/i)).toHaveTextContent("English");
  });
});
