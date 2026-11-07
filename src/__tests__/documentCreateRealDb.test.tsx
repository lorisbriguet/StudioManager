import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Creating a quote or an invoice against a real SQLite database: every field
// the form picks (billing address, template, project link) must be saved on
// the first save, and an Undo of a delete must bring them all back.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { createQuoteWithLineItems } from "../db/queries/quotes";
import { createInvoiceWithLineItems } from "../db/queries/invoices";
import { useDeleteQuote } from "../db/hooks/useQuotes";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import type { Quote } from "../types/quote";
import type { Invoice } from "../types/invoice";

const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const one = (sql: string, ...params: (string | number | null)[]) =>
  prep(sql).get(...params) as Record<string, unknown> | undefined;
const run = (sql: string, ...params: (string | number | null)[]) => prep(sql).run(...params);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ITEM = { designation: "Logo", rate: 100, unit: "h", quantity: 2, amount: 200, sort_order: 0 };

function newQuote(): Omit<Quote, "id" | "created_at" | "updated_at"> {
  return {
    reference: "DRAFT-q1",
    client_id: "c1",
    project_id: 1,
    billing_address_id: 7,
    status: "draft",
    language: "FR",
    activity: "Design",
    activity_id: null,
    assignment: "",
    quote_date: "2026-11-01",
    valid_until: "2026-12-01",
    subtotal: 200,
    discount_applied: 0,
    discount_rate: 0,
    total: 200,
    converted_to_invoice_id: null,
    converted_to_project_id: null,
    notes: "",
    template_id: 3,
  };
}

beforeEach(async () => {
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  await freshRealDb();
  run("INSERT INTO clients (id, name) VALUES ('c1', 'ACME')");
  run("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Site')");
  run("INSERT INTO projects (id, client_id, name) VALUES (2, 'c1', 'From quote')");
  run("INSERT INTO client_addresses (id, client_id, label) VALUES (7, 'c1', 'Second office')");
  run("INSERT INTO invoice_templates (id, name) VALUES (3, 'Picked')");
});

describe("creating a document saves every field", () => {
  it("a new quote keeps its billing address and template", async () => {
    const id = await createQuoteWithLineItems(newQuote(), [ITEM]);
    const row = one("SELECT * FROM quotes WHERE id = $1", id);
    expect(row?.billing_address_id).toBe(7);
    expect(row?.template_id).toBe(3);
    expect(row?.project_id).toBe(1);
    expect(one("SELECT COUNT(*) AS n FROM quote_line_items WHERE quote_id = $1", id)?.n).toBe(1);
  });

  it("undoing a quote delete brings back address, template and project link", async () => {
    const id = await createQuoteWithLineItems({ ...newQuote(), converted_to_project_id: 2 }, [ITEM]);
    const del = renderHook(() => useDeleteQuote(), { wrapper }).result.current;
    await del.mutateAsync(id);
    expect(one("SELECT id FROM quotes WHERE id = $1", id)).toBeUndefined();

    await useUndoStore.getState().stack[0].execute();
    const row = one("SELECT * FROM quotes WHERE reference = 'DRAFT-q1'");
    expect(row?.billing_address_id).toBe(7);
    expect(row?.template_id).toBe(3);
    expect(row?.converted_to_project_id).toBe(2);
    expect(one("SELECT COUNT(*) AS n FROM quote_line_items WHERE quote_id = $1", row?.id as number)?.n).toBe(1);
  });

  it("a new invoice keeps its fields and the currency defaults", async () => {
    const data = {
      reference: "DRAFT-i1",
      client_id: "c1",
      project_id: 1,
      contact_id: null,
      billing_address_id: 7,
      status: "draft",
      language: "FR",
      activity: "Design",
      activity_id: null,
      assignment: "",
      invoice_date: "2026-11-01",
      due_date: "2026-12-01",
      payment_terms_days: 30,
      subtotal: 200,
      discount_applied: 0,
      discount_rate: 0,
      discount_label: "",
      total: 200,
      po_number: null,
      paid_date: null,
      pdf_path: null,
      from_quote_id: null,
      notes: "",
      reminder_count: 0,
      last_reminder_date: null,
      template_id: 3,
    } as unknown as Omit<Invoice, "id" | "created_at" | "updated_at">;
    const id = await createInvoiceWithLineItems(data, [ITEM]);
    const row = one("SELECT * FROM invoices WHERE id = $1", id);
    expect(row?.billing_address_id).toBe(7);
    expect(row?.template_id).toBe(3);
    expect(row?.currency).toBe("CHF");
    expect(row?.exchange_rate).toBe(1);
    expect(row?.chf_equivalent).toBe(200);
  });
});
