import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Invoices and quotes share their hooks. These tests pin what each kind's
// hooks call and what their undo/redo do, including the invoice-only rules:
// a PDF is generated on save once sent, and only drafts can be deleted.

const { inv, quo, pdf } = vi.hoisted(() => {
  const queries = () => ({
    list: vi.fn(async () => [{ id: 1 }]),
    get: vi.fn(),
    byProject: vi.fn(async () => []),
    byClient: vi.fn(async () => []),
    lineItems: vi.fn(async (_id: number): Promise<unknown[]> => []),
    create: vi.fn(async () => 41),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    nextRef: vi.fn(async () => "NEXT-REF"),
  });
  return { inv: queries(), quo: queries(), pdf: vi.fn(async () => {}) };
});

vi.mock("../db/queries/invoices", () => ({
  getInvoices: inv.list,
  getInvoice: inv.get,
  getInvoicesByProject: inv.byProject,
  getInvoicesByClient: inv.byClient,
  getInvoiceLineItems: inv.lineItems,
  createInvoiceWithLineItems: inv.create,
  updateInvoiceWithLineItems: inv.update,
  deleteInvoice: inv.remove,
  getNextInvoiceReference: inv.nextRef,
}));
vi.mock("../db/queries/quotes", () => ({
  getQuotes: quo.list,
  getQuote: quo.get,
  getQuotesByProject: quo.byProject,
  getQuoteLineItems: quo.lineItems,
  createQuoteWithLineItems: quo.create,
  updateQuoteWithLineItems: quo.update,
  deleteQuote: quo.remove,
  getNextQuoteReference: quo.nextRef,
}));
vi.mock("../lib/invoicePdfStore", () => ({ generateAndStoreInvoicePdf: pdf }));
// The failed-PDF case logs through the Tauri log plugin, which tests can't reach.
vi.mock("../lib/log", () => ({
  logError: vi.fn(async () => {}),
  logWarn: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
}));

import * as invHooks from "../db/hooks/useInvoices";
import * as quoHooks from "../db/hooks/useQuotes";
import { useQuoteLineItems } from "../db/hooks/useQuoteLineItems";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const invalidated = () =>
  (qc.invalidateQueries as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => (c[0] as { queryKey: unknown[] }).queryKey
  );

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(qc, "invalidateQueries");
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
});

const item = { designation: "Logo", rate: 100, unit: "h", quantity: 2, amount: 200, sort_order: 0 };

const kinds = [
  {
    name: "invoice",
    q: inv,
    key: "invoices",
    lineItemsKey: (id: number) => ["invoice-line-items", id],
    fk: "invoice_id",
    dateField: "invoice_date",
    word: "invoice",
    pdfOnSave: true,
    draftOnlyDelete: true,
    h: {
      useList: invHooks.useInvoices,
      useOne: invHooks.useInvoice,
      useByProject: invHooks.useInvoicesByProject,
      useLineItems: invHooks.useInvoiceLineItems,
      useCreate: invHooks.useCreateInvoice,
      useUpdate: invHooks.useUpdateInvoice,
      useDelete: invHooks.useDeleteInvoice,
    },
  },
  {
    name: "quote",
    q: quo,
    key: "quotes",
    lineItemsKey: (id: number) => ["quotes", id, "lineItems"],
    fk: "quote_id",
    dateField: "quote_date",
    word: "quote",
    pdfOnSave: false,
    draftOnlyDelete: false,
    h: {
      useList: quoHooks.useQuotes,
      useOne: quoHooks.useQuote,
      useByProject: quoHooks.useQuotesByProject,
      useLineItems: useQuoteLineItems,
      useCreate: quoHooks.useCreateQuote,
      useUpdate: quoHooks.useUpdateQuote,
      useDelete: quoHooks.useDeleteQuote,
    },
  },
] as const;

describe.each(kinds)("$name hooks", (k) => {
  const doc = (over: Record<string, unknown> = {}) => ({
    id: 5,
    reference: "DRAFT-1",
    status: "draft",
    [k.dateField]: "2025-03-01",
    notes: "old",
    created_at: "c",
    updated_at: "u",
    ...over,
  });

  it("reads under the expected query keys", async () => {
    k.q.get.mockResolvedValue(doc());
    renderHook(() => k.h.useList(), { wrapper });
    renderHook(() => k.h.useOne(5), { wrapper });
    renderHook(() => k.h.useByProject(3), { wrapper });
    renderHook(() => k.h.useLineItems(5), { wrapper });
    await waitFor(() => expect(k.q.lineItems).toHaveBeenCalledWith(5));
    expect(k.q.list).toHaveBeenCalled();
    expect(k.q.get).toHaveBeenCalledWith(5);
    expect(k.q.byProject).toHaveBeenCalledWith(3);
    const keys = qc.getQueryCache().getAll().map((x) => x.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([[k.key], [k.key, 5], [k.key, "project", 3], k.lineItemsKey(5)])
    );
  });

  it("does not fetch for id 0", () => {
    renderHook(() => k.h.useOne(0), { wrapper });
    renderHook(() => k.h.useByProject(0), { wrapper });
    renderHook(() => k.h.useLineItems(0), { wrapper });
    expect(k.q.get).not.toHaveBeenCalled();
    expect(k.q.byProject).not.toHaveBeenCalled();
    expect(k.q.lineItems).not.toHaveBeenCalled();
  });

  it("creates, with an undo that deletes and a redo that recreates", async () => {
    const { result } = renderHook(() => k.h.useCreate(), { wrapper });
    const data = { reference: "DRAFT-9" } as never;
    expect(await result.current.mutateAsync({ data, lineItems: [item] })).toBe(41);
    expect(k.q.create).toHaveBeenCalledWith(data, [item]);
    expect(invalidated()).toEqual([[k.key], ["finance"]]);

    const action = useUndoStore.getState().stack[0];
    expect(action.label).toBe(`Create ${k.word} "DRAFT-9"`);
    await action.execute();
    expect(k.q.remove).toHaveBeenCalledWith(41);
    await action.redo!();
    expect(k.q.create).toHaveBeenCalledTimes(2);
  });

  it("assigns the next reference for the document's year when sent", async () => {
    k.q.get.mockResolvedValue(doc());
    const { result } = renderHook(() => k.h.useUpdate(), { wrapper });
    await result.current.mutateAsync({ id: 5, data: { status: "sent" } as never });
    expect(k.q.nextRef).toHaveBeenCalledWith(2025);
    expect(k.q.update).toHaveBeenCalledWith(5, { status: "sent", reference: "NEXT-REF" }, undefined);
    expect(pdf).toHaveBeenCalledTimes(k.pdfOnSave ? 1 : 0);
    if (k.pdfOnSave) expect(pdf).toHaveBeenCalledWith(5);
  });

  it("numbers sends that start at once one after another", async () => {
    // Each saved send moves the counter, like MAX(reference) in the table
    let saved = 0;
    k.q.get.mockImplementation(async (id: number) => doc({ id, reference: `DRAFT-${id}` }));
    k.q.nextRef.mockImplementation(async () => `REF-${saved + 1}`);
    k.q.update.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      saved++;
    });
    const { result } = renderHook(() => k.h.useUpdate(), { wrapper });
    await Promise.all(
      [1, 2, 3].map((id) => result.current.mutateAsync({ id, data: { status: "sent" } as never }))
    );
    const refs = (k.q.update.mock.calls as unknown as [number, { reference: string }][]).map((c) => c[1].reference);
    expect(refs).toEqual(["REF-1", "REF-2", "REF-3"]);
  });

  it("keeps a real reference when sent again", async () => {
    k.q.get.mockResolvedValue(doc({ reference: "2025-004", status: "sent" }));
    const { result } = renderHook(() => k.h.useUpdate(), { wrapper });
    await result.current.mutateAsync({ id: 5, data: { status: "sent" } as never });
    expect(k.q.nextRef).not.toHaveBeenCalled();
  });

  it("refuses to go back to draft", async () => {
    k.q.get.mockResolvedValue(doc({ reference: "2025-004", status: "sent" }));
    const { result } = renderHook(() => k.h.useUpdate(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: 5, data: { status: "draft" } as never })
    ).rejects.toThrow("Cannot revert to draft status");
    expect(k.q.update).not.toHaveBeenCalled();
  });

  it("generates no PDF while still a draft", async () => {
    k.q.get.mockResolvedValue(doc());
    const { result } = renderHook(() => k.h.useUpdate(), { wrapper });
    await result.current.mutateAsync({ id: 5, data: { notes: "new" } as never });
    expect(pdf).not.toHaveBeenCalled();
  });

  it("updates, with an undo that restores the old fields and line items", async () => {
    k.q.get.mockResolvedValue(doc());
    k.q.lineItems.mockResolvedValue([{ id: 70, [k.fk]: 5, ...item, designation: "Old" }]);
    const { result } = renderHook(() => k.h.useUpdate(), { wrapper });
    await result.current.mutateAsync({ id: 5, data: { notes: "new" } as never, lineItems: [item] });
    expect(k.q.update).toHaveBeenCalledWith(5, { notes: "new" }, [item]);
    expect(invalidated()).toEqual([[k.key], k.lineItemsKey(5), ["finance"]]);

    const action = useUndoStore.getState().stack[0];
    expect(action.label).toBe(`Update ${k.word} "DRAFT-1"`);
    await action.execute();
    expect(k.q.update).toHaveBeenLastCalledWith(5, { notes: "old" }, [{ ...item, designation: "Old" }]);
    await action.redo!();
    expect(k.q.update).toHaveBeenLastCalledWith(5, { notes: "new" }, [item]);
  });

  it("deletes a draft, with an undo that restores it and a redo that deletes the restored row", async () => {
    k.q.get.mockResolvedValue(doc());
    k.q.lineItems.mockResolvedValue([{ id: 70, [k.fk]: 5, ...item }]);
    const { result } = renderHook(() => k.h.useDelete(), { wrapper });
    await result.current.mutateAsync(5);
    expect(k.q.remove).toHaveBeenCalledWith(5);
    expect(invalidated()).toEqual([[k.key], ["finance"]]);

    const action = useUndoStore.getState().stack[0];
    expect(action.label).toBe(`Delete ${k.word} "DRAFT-1"`);
    await action.execute();
    expect(k.q.create).toHaveBeenCalledWith(
      { reference: "DRAFT-1", status: "draft", [k.dateField]: "2025-03-01", notes: "old" },
      [item]
    );
    await action.redo!();
    expect(k.q.remove).toHaveBeenLastCalledWith(41);
  });

  it(k.draftOnlyDelete ? "refuses to delete a sent one" : "deletes a sent one", async () => {
    k.q.get.mockResolvedValue(doc({ reference: "2025-004", status: "sent" }));
    const { result } = renderHook(() => k.h.useDelete(), { wrapper });
    const run = result.current.mutateAsync(5);
    if (k.draftOnlyDelete) {
      await expect(run).rejects.toThrow("Only draft invoices can be deleted");
      expect(k.q.remove).not.toHaveBeenCalled();
    } else {
      await run;
      expect(k.q.remove).toHaveBeenCalledWith(5);
    }
  });
});

describe("invoice-only hooks", () => {
  it("lists by client", async () => {
    renderHook(() => invHooks.useInvoicesByClient("c1"), { wrapper });
    await waitFor(() => expect(inv.byClient).toHaveBeenCalledWith("c1"));
    expect(qc.getQueryCache().getAll()[0].queryKey).toEqual(["invoices", "client", "c1"]);
  });

  it("a failed PDF does not fail the save", async () => {
    inv.get.mockResolvedValue({ id: 5, reference: "2025-004", status: "sent", invoice_date: "2025-03-01" });
    pdf.mockRejectedValueOnce(new Error("render failed"));
    const { result } = renderHook(() => invHooks.useUpdateInvoice(), { wrapper });
    await result.current.mutateAsync({ id: 5, data: { notes: "x" } as never });
    expect(inv.update).toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toHaveLength(1);
  });
});
