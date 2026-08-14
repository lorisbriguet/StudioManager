import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { InvoicesPage } from "../pages/InvoicesPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";
import { todayLocalISO } from "../utils/localDate";
import { undoable } from "../lib/undo";

vi.mock("../lib/undo", () => ({
  undoable: vi.fn(),
  undoableFromStore: vi.fn(),
}));

// Row-level "mark paid" must be undoable like the status dropdown and the
// bulk action — reverting restores the previous status and paid_date.

const YEAR = new Date().getFullYear();

const invoiceRow = {
  id: 7,
  reference: "2026-0007",
  client_id: "c1",
  project_id: null,
  contact_id: null,
  billing_address_id: null,
  template_id: null,
  status: "sent",
  invoice_date: `${YEAR}-02-01`,
  due_date: `${YEAR}-03-01`,
  paid_date: null,
  total: 500,
  currency: "CHF",
  chf_equivalent: 0,
  reminder_count: 0,
  pdf_path: null,
};

function renderPage() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM invoices WHERE id")) return [invoiceRow];
    if (flat.includes("FROM invoices")) return [invoiceRow];
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
  vi.mocked(undoable).mockClear();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("invoice row mark paid", () => {
  it("marks paid today and registers an undo restoring the previous state", async () => {
    renderPage();
    const row = (await screen.findByText("ACME")).closest("tr")!;
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /mark as paid/i }));

    const today = todayLocalISO();
    await waitFor(() => {
      const upd = executedStatements.find((s) => s.sql.includes("UPDATE invoices SET"));
      expect(upd).toBeDefined();
      expect(upd!.params).toContain("paid");
      expect(upd!.params).toContain(today);
    });

    // Undo must be registered and revert to the pre-click status/paid_date
    await waitFor(() => expect(undoable).toHaveBeenCalled());
    clearExecutedStatements();
    const rollback = vi.mocked(undoable).mock.calls[0][1] as () => Promise<unknown>;
    await rollback();
    const revert = executedStatements.find((s) => s.sql.includes("UPDATE invoices SET"));
    expect(revert).toBeDefined();
    expect(revert!.params).toContain("sent");
  });
});
