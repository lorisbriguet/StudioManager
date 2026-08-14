import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoicePreviewPage } from "../pages/InvoicePreviewPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// "Mark as sent & export" bug: the exported file was named from the stale
// draft invoice captured in the component closure, and any error left the
// draft-warning modal soft-locked. The export must use the freshly updated
// invoice (new reference, stored PDF).

vi.mock("@react-pdf/renderer", () => ({
  PDFViewer: () => null,
  pdf: () => ({
    toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
  }),
}));
vi.mock("../lib/pdfPostProcess", () => ({
  postProcessInvoicePdf: async (bytes: Uint8Array) => bytes,
}));
vi.mock("../components/invoice/InvoicePDF", () => ({ InvoicePDF: () => null }));

const draftRow = {
  id: 5,
  reference: "DRAFT-2026-001",
  client_id: "c1",
  project_id: null,
  contact_id: null,
  billing_address_id: null,
  template_id: null,
  status: "draft",
  invoice_date: "2026-03-01",
  due_date: "2026-03-31",
  total: 100,
  currency: "CHF",
  chf_equivalent: 0,
  reminder_count: 0,
  pdf_path: null,
};

const sentRow = {
  ...draftRow,
  status: "sent",
  reference: "2026-0001",
  pdf_path: "/stored/2026-0001_ACME.pdf",
};

const lineItem = {
  id: 1,
  invoice_id: 5,
  designation: "Work",
  rate: 100,
  unit: "h",
  quantity: 1,
  amount: 100,
  sort_order: 0,
};

let downloads: string[];

function renderPage() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM invoice_line_items")) return [lineItem];
    if (flat.includes("FROM invoices WHERE id")) {
      // After the status update ran, the DB row has the real reference
      const updated = executedStatements.some((s) => s.sql.includes("UPDATE invoices SET"));
      return [updated ? sentRow : draftRow];
    }
    if (flat.includes("FROM invoices")) return []; // next-reference lookup
    if (flat.includes("FROM business_profile")) return [{ id: 1, name: "Studio" }];
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/invoices/5"]}>
        <Routes>
          <Route path="/invoices/:id" element={<InvoicePreviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
  downloads = [];
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  setSelectHandler(null);
  cleanup();
});

describe("mark as sent and export", () => {
  it("exports under the freshly assigned reference and closes the modal", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark as sent/i }));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]).toBe("2026-0001_ACME.pdf");
    // Modal must be gone — no soft-lock
    expect(screen.queryByRole("button", { name: /mark as sent/i })).not.toBeInTheDocument();
  });
});
