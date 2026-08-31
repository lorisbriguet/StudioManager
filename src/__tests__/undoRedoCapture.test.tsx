import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDeleteIncome } from "../db/hooks/useIncome";
import { useDeleteClientContact, useDeleteClientAddress } from "../db/hooks/useClients";
import { useDeleteRecurringTemplate } from "../db/hooks/useRecurring";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Audit round 3: redo must target exactly the row id produced by the undo's
// restore (mock lastInsertId = 1), never a name/reference lookalike (id 999).

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function runUndoRedo() {
  const action = useUndoStore.getState().stack[0];
  expect(action).toBeDefined();
  await action.execute(); // undo: restore, mock reports lastInsertId 1
  clearExecutedStatements();
  expect(action.redo).toBeDefined();
  await action.redo!(); // redo: must delete restored id 1
  return executedStatements.find((s) => s.sql.includes("DELETE FROM"));
}

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  clearExecutedStatements();
});

describe("redo id-capture", () => {
  it("income: redo deletes the restored id, not a reference lookalike", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM income WHERE id")) {
        return [{ id: params[0], reference: "INC-0007", source: "ACME", date: "2026-01-01", amount: 1, category: "refund", description: "", receipt_path: null, notes: "" }];
      }
      if (flat.includes("FROM income")) {
        return [{ id: 999, reference: "INC-0007" }]; // lookalike
      }
      return [];
    });
    const { result } = renderHook(() => useDeleteIncome(), { wrapper });
    result.current.mutate(7);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));

    const del = await runUndoRedo();
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });

  it("client contact: redo deletes the restored id, not a name lookalike", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM client_contacts WHERE id")) {
        return [{ id: params[0], client_id: "c1", first_name: "Ana", last_name: "B", email: "a@b.c", phone: "", role: "" }];
      }
      if (flat.includes("FROM client_contacts")) {
        return [{ id: 999, first_name: "Ana", last_name: "B", email: "a@b.c" }];
      }
      return [];
    });
    const { result } = renderHook(() => useDeleteClientContact(), { wrapper });
    result.current.mutate({ id: 5, clientId: "c1" });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));

    const del = await runUndoRedo();
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });

  it("client address: redo deletes the restored id, not a label lookalike", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM client_addresses WHERE id")) {
        return [{ id: params[0], client_id: "c1", label: "HQ", billing_name: "ACME", address_line1: "", address_line2: "", postal_city: "" }];
      }
      if (flat.includes("FROM client_addresses")) {
        return [{ id: 999, label: "HQ", billing_name: "ACME" }];
      }
      return [];
    });
    const { result } = renderHook(() => useDeleteClientAddress(), { wrapper });
    result.current.mutate({ id: 5, clientId: "c1" });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));

    const del = await runUndoRedo();
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });

  it("recurring template delete: undo arms a redo that deletes the restored id", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM recurring_invoice_templates WHERE id")) {
        return [{ id: params[0], client_id: "c1", frequency: "monthly", next_due: "2026-01-01", active: 1 }];
      }
      return [];
    });
    const { result } = renderHook(() => useDeleteRecurringTemplate(), { wrapper });
    result.current.mutate(4);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));

    const del = await runUndoRedo();
    expect(del).toBeDefined();
    expect(del!.sql).toContain("recurring_invoice_templates");
    expect(del!.params).toContain(1);
  });
});
