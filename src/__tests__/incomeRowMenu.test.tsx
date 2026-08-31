import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IncomePage } from "../pages/IncomePage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Receipt OCR/PDF extraction is irrelevant here.
vi.mock("../lib/pdfExtract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
}));

const YEAR = new Date().getFullYear();

const income = {
  id: 7,
  reference: "INC-0007",
  source: "ACME Refund",
  description: "",
  category: "refund",
  date: `${YEAR}-01-10`,
  amount: 120,
  receipt_path: null,
  notes: "",
  created_at: "",
  updated_at: "",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IncomePage />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  setSelectHandler((sql) => {
    if (sql.replace(/\s+/g, " ").includes("FROM income")) return [income];
    return [];
  });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("Income row menu", () => {
  it("offers Edit and Delete in the row context menu", async () => {
    renderPage();
    const row = (await screen.findByText("ACME Refund")).closest("tr")!;
    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });

  it("has a rest-visible row trigger that opens the same menu", async () => {
    renderPage();
    const row = (await screen.findByText("ACME Refund")).closest("tr")!;
    const trigger = row.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
    expect(trigger).not.toBeNull();
    expect(trigger.className).not.toContain("opacity-0");
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
  });

  it("Edit opens the form prefilled and saves an UPDATE", async () => {
    renderPage();
    const row = (await screen.findByText("ACME Refund")).closest("tr")!;
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /edit/i }));

    const sourceInput = await screen.findByDisplayValue("ACME Refund");
    fireEvent.change(sourceInput, { target: { value: "ACME Refund SA" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const update = executedStatements.find((s) =>
        s.sql.replace(/\s+/g, " ").includes("UPDATE income")
      );
      expect(update).toBeDefined();
      expect(update!.params).toContain("ACME Refund SA");
    });
  });
});
