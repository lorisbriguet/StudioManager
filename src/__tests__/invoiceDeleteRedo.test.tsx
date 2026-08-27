import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDeleteInvoice } from "../db/hooks/useInvoices";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Redo of an invoice deletion used to re-locate the restored row BY
// REFERENCE — fragile if another row plausibly matches. It must delete
// exactly the row id produced by the undo's restore.

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useDeleteInvoice redo", () => {
  beforeAll(async () => {
    await getDb();
  });

  beforeEach(() => {
    useAppStore.setState({ language: "EN" });
    useUndoStore.setState({ stack: [], redoStack: [] });
    clearExecutedStatements();
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM invoices WHERE id")) {
        // Any id resolves to a deletable draft
        return [{ id: params[0], reference: "DRAFT-X", status: "draft", client_id: "c1" }];
      }
      if (flat.includes("FROM invoice_line_items")) return [];
      if (flat.includes("FROM invoices")) {
        // A DIFFERENT row that happens to carry the same reference — the
        // old reference-matching redo would target this one
        return [{ id: 999, reference: "DRAFT-X", status: "draft", client_id: "c1" }];
      }
      return [];
    });
  });

  it("redo deletes the row restored by undo, not a reference lookalike", async () => {
    const { result } = renderHook(() => useDeleteInvoice(), { wrapper });
    result.current.mutate(3);
    await waitFor(() => {
      expect(useUndoStore.getState().stack).toHaveLength(1);
    });
    const action = useUndoStore.getState().stack[0];

    // Undo: restore — the execute_batch mock reports lastInsertId 1
    await action.execute();
    clearExecutedStatements();

    // Redo must delete exactly the restored id (1), not the lookalike (999)
    await action.redo!();
    const del = executedStatements.find((s) => s.sql.includes("DELETE FROM invoices"));
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });
});
