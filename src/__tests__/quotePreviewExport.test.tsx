import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QuotePreviewPage } from "../pages/QuotePreviewPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Same class of bug as the invoice preview: "mark as sent & export" must
// export under the freshly assigned reference (not the stale draft closure),
// and the draft warning must behave like a real dialog (Escape closes).

vi.mock("@react-pdf/renderer", () => ({
  PDFViewer: () => null,
  pdf: () => ({
    toBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
  }),
}));
vi.mock("../components/quote/QuotePDF", () => ({ QuotePDF: () => null }));

const draftRow = {
  id: 9,
  reference: "DRAFT-2026-Q1",
  client_id: "c1",
  project_id: null,
  billing_address_id: null,
  template_id: null,
  status: "draft",
  quote_date: "2026-03-01",
  valid_until: "2026-03-31",
  total: 250,
  converted_to_project_id: null,
};

const sentRow = { ...draftRow, status: "sent", reference: "2026-Q001" };

const lineItem = {
  id: 1,
  quote_id: 9,
  designation: "Work",
  rate: 250,
  unit: "h",
  quantity: 1,
  amount: 250,
  sort_order: 0,
};

let downloads: string[];

function renderPage() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM quote_line_items")) return [lineItem];
    if (flat.includes("FROM quotes WHERE id")) {
      const updated = executedStatements.some((s) => s.sql.includes("UPDATE quotes SET"));
      return [updated ? sentRow : draftRow];
    }
    if (flat.includes("FROM quotes")) return []; // next-reference lookup
    if (flat.includes("FROM business_profile")) return [{ id: 1, name: "Studio" }];
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/quotes/9"]}>
        <Routes>
          <Route path="/quotes/:id" element={<QuotePreviewPage />} />
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

describe("quote mark as sent and export", () => {
  it("exports under the freshly assigned reference", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));
    fireEvent.click(await screen.findByRole("button", { name: /mark as sent/i }));

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]).toBe("2026-Q001_ACME.pdf");
  });

  it("closes the draft warning with Escape", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));
    await screen.findByRole("button", { name: /mark as sent/i });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /mark as sent/i })).not.toBeInTheDocument();
    });
    expect(downloads).toHaveLength(0);
  });
});
