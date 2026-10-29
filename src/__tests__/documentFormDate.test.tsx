import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoiceFormPage } from "../pages/InvoiceFormPage";
import { QuoteFormPage } from "../pages/QuoteFormPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";
import { confirm } from "../lib/confirm";

vi.mock("../lib/confirm", async (orig) => ({ ...(await orig<object>()), confirm: vi.fn(async () => false) }));

// The date field of the invoice and quote forms is a DatePicker: a calendar
// pick sends no DOM change event (the form must still turn dirty), and a
// two-digit year typed then Tabbed away commits only on blur (validation
// must see the settled date, not the stale state).

function mountAt(path: string, element: React.ReactElement) {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM clients")) return [{ id: "C-001", name: "Atelier Noir", language: "FR", has_discount: 0, discount_rate: 0 }];
    if (flat.includes("FROM business_profile")) return [{ id: 1, owner_name: "Studio" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN", dateFormat: "dd.MM.yyyy" });
  clearExecutedStatements();
  vi.mocked(confirm).mockClear();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

const forms = [
  ["invoice", "/invoices/new", <InvoiceFormPage />],
  ["quote", "/quotes/new", <QuoteFormPage />],
] as const;

describe.each(forms)("%s form date field", (_name, path, element) => {
  it("a calendar pick marks the form dirty", async () => {
    mountAt(path, element);
    const field = await screen.findByRole("textbox", { name: /^date/i });
    const wrap = field.closest("div.relative") as HTMLElement;
    fireEvent.click(within(wrap).getByRole("button", { name: "Pick a date" }));
    const dialog = await screen.findByRole("dialog");
    // Any day that isn't today's: the 15th or the 16th
    const day = within(dialog).getAllByRole("button", { name: /\b1[56] / }).find((b) => b.getAttribute("aria-pressed") !== "true")!;
    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
  });

  it("typing a two-digit year then leaving the field does not show 'required'", async () => {
    mountAt(path, element);
    const field = await screen.findByRole("textbox", { name: /^date/i });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.change(field, { target: { value: "1.2.26" } });
    fireEvent.blur(field);
    await waitFor(() => expect(field).toHaveValue("01.02.2026"));
    expect(screen.queryByText(/required/i)).toBeNull();
  });
});
