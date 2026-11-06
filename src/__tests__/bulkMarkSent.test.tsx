import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";
import { useAppStore } from "../stores/app-store";
import { useUndoStore } from "../stores/undo-store";

vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));
vi.mock("../lib/log", () => ({
  logError: vi.fn(async () => {}),
  logWarn: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
}));
// No original module: loading it pulls in @react-pdf, which the first send
// would wait for inside waitFor's 1 s (the cause of a flaky failure).
vi.mock("../lib/invoicePdfStore", () => ({
  generateAndStoreInvoicePdf: vi.fn(async () => {}),
}));

import { notify } from "../lib/notify";
import { InvoicesPage } from "../pages/InvoicesPage";
import { QuotesPage } from "../pages/QuotesPage";

// Bulk "Mark as sent" used to start every update at once: each read the same
// MAX reference before any was written, so all drafts got the same number and
// all but one failed. A send that assigns a number has no undo: undoing it
// would free the number for the next document.

const YEAR = 2026;

/**
 * A tiny in-memory table: three drafts, plus whatever UPDATEs have been
 * executed so far, so the reference generator sees earlier writes.
 */
function table(name: "invoices" | "quotes", dateField: string) {
  const base = [1, 2, 3].map((id) => ({
    id,
    reference: `DRAFT-${id}`,
    status: "draft",
    client_id: "c1",
    project_id: null,
    [dateField]: `${YEAR}-02-0${id}`,
    total: 100 * id,
    currency: "CHF",
    chf_equivalent: 0,
    reminder_count: 0,
    pdf_path: null,
    discount_rate: 0,
    notes: "",
  }));
  const rows = () => {
    const out = base.map((r) => ({ ...r }));
    for (const s of executedStatements) {
      const m = s.sql.match(new RegExp(`^UPDATE ${name} SET (.+?), updated_at`));
      if (!m) continue;
      const fields = m[1].split(", ").map((f) => f.split(" = ")[0]);
      const row = out.find((r) => r.id === s.params[0]);
      if (row) fields.forEach((f, i) => ((row as Record<string, unknown>)[f] = s.params[i + 1]));
    }
    return out;
  };
  setSelectHandler((sql, params) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("MAX(CAST(SUBSTR")) {
      const prefix = (params[1] as string).slice(0, -1);
      const nums = rows()
        .filter((r) => r.reference.startsWith(prefix))
        .map((r) => parseInt(r.reference.slice(prefix.length), 10));
      return [{ max_num: nums.length ? Math.max(...nums) : null }];
    }
    if (flat.includes(`FROM ${name} WHERE id`)) return rows().filter((r) => r.id === params[0]);
    if (flat.includes(`FROM ${name}`)) return rows();
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME" }];
    return [];
  });
  return rows;
}

function renderPage(page: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  vi.clearAllMocks();
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe.each([
  { name: "invoices", dateField: "invoice_date", page: <InvoicesPage />, refs: ["2026-001", "2026-002", "2026-003"] },
  { name: "quotes", dateField: "quote_date", page: <QuotesPage />, refs: ["D-2026-001", "D-2026-002", "D-2026-003"] },
] as const)("bulk mark as sent: $name", ({ name, dateField, page, refs }) => {
  it("gives three drafts consecutive numbers, with no undo", async () => {
    const rows = table(name, dateField);
    renderPage(page);
    await waitFor(() => expect(screen.getAllByText("ACME")).toHaveLength(3));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark as sent" }));

    await waitFor(() => expect(rows().map((r) => r.status)).toEqual(["sent", "sent", "sent"]));
    expect(rows().map((r) => r.reference).sort()).toEqual(refs);

    // Numbered documents can't be undone: undo would free their numbers
    expect(notify.undo).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toHaveLength(0);
    expect(notify.error).not.toHaveBeenCalled();
  });
});
