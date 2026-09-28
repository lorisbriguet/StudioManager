import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useDeleteProjectTable } from "../db/hooks/useProjectTables";
import { useDeleteWikiArticle } from "../db/hooks/useWiki";
import { useDeleteResource } from "../db/hooks/useResources";
import { useDeleteQuote } from "../db/hooks/useQuotes";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// P1-2: redo after an undone delete used to re-find the restored record by a
// non-unique field (name/title/reference) instead of the id the restore
// (undo's `execute`) actually produced. When a different row shares that
// field's default/colliding value, redo could delete THAT row instead —
// cascading to its children. Each test here simulates exactly that
// collision and proves redo targets the id the mock's INSERT reported
// (lastInsertId = 1), never the lookalike row (id 999).

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  clearExecutedStatements();
});

describe("useDeleteProjectTable redo", () => {
  it("redo deletes the table restored by undo, not a name lookalike", async () => {
    // Before delete: two tables in the project both carry the default
    // "Untitled" name (id 5 is the one being deleted; id 999 is unrelated).
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("MAX(sort_order)")) return [{ m: null }];
      if (flat.includes("FROM project_table_rows")) return [];
      if (flat.includes("FROM project_tables")) {
        return [
          { id: 5, project_id: 1, name: "Untitled", column_config: "[]", sort_order: 0 },
        ];
      }
      return [];
    });

    const { result } = renderHook(() => useDeleteProjectTable(1), { wrapper });
    result.current.mutate(5);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];

    clearExecutedStatements();
    await action.execute(); // undo: restore, mock reports lastInsertId 1

    // Post-restore world: the original row (id 5) is gone; a DIFFERENT
    // table (id 999) that happens to also be named "Untitled" is what the
    // old name-lookup would find.
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM project_tables")) {
        return [{ id: 999, project_id: 1, name: "Untitled", column_config: "[]", sort_order: 1 }];
      }
      return [];
    });

    clearExecutedStatements();
    expect(action.redo).toBeDefined();
    await action.redo!(); // redo: must delete restored id 1, not the lookalike

    const del = executedStatements.find((s) => s.sql.includes("DELETE FROM project_tables WHERE id"));
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });
});

describe("useDeleteWikiArticle redo", () => {
  it("redo deletes the article restored by undo, not a title+folder lookalike", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("WHERE a.id = $1")) {
        return [
          {
            id: params[0],
            folder_id: 2,
            project_id: null,
            title: "Untitled",
            content: "",
            sort_order: 0,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
            project_name: null,
          },
        ];
      }
      if (flat.includes("MAX(sort_order)")) return [{ m: null }];
      if (flat.includes("GROUP_CONCAT")) return [];
      if (flat.includes("wiki_article_tags")) return [];
      return [];
    });

    const { result } = renderHook(() => useDeleteWikiArticle(), { wrapper });
    result.current.mutate(5);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];

    clearExecutedStatements();
    await action.execute(); // undo: restore, mock reports lastInsertId 1

    // Post-restore world: a DIFFERENT article (id 999) in the same folder
    // also happens to be titled "Untitled" — the old title+folder lookup
    // would find this one.
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("GROUP_CONCAT")) {
        return [{ id: 999, folder_id: 2, project_id: null, title: "Untitled", tags_csv: null, project_name: null }];
      }
      if (flat.includes("wiki_article_tags")) return [];
      return [];
    });

    clearExecutedStatements();
    expect(action.redo).toBeDefined();
    await action.redo!(); // redo: must delete restored id 1, not the lookalike

    const del = executedStatements.find((s) => s.sql.includes("DELETE FROM wiki_articles"));
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });
});

describe("useDeleteResource redo", () => {
  it("redo deletes the resource restored by undo, not a name+url lookalike", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("resource_tags")) return [];
      if (flat.includes("WHERE id = $1")) {
        return [
          {
            id: params[0],
            name: "Untitled",
            url: "https://example.com",
            price: "",
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ];
      }
      if (flat.includes("FROM resources")) return [];
      return [];
    });

    const { result } = renderHook(() => useDeleteResource(), { wrapper });
    result.current.mutate(5);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];

    clearExecutedStatements();
    await action.execute(); // undo: restore, mock reports lastInsertId 1

    // Post-restore world: a DIFFERENT resource (id 999) shares the same
    // name+url — the old lookup would find this one instead.
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("resource_tags")) return [];
      if (flat.includes("FROM resources")) {
        return [{ id: 999, name: "Untitled", url: "https://example.com", price: "" }];
      }
      return [];
    });

    clearExecutedStatements();
    expect(action.redo).toBeDefined();
    await action.redo!(); // redo: must delete restored id 1, not the lookalike

    const del = executedStatements.find((s) => s.sql.includes("DELETE FROM resources"));
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });
});

describe("useDeleteQuote redo", () => {
  // The `reference` column is UNIQUE in the schema, so this collision can't
  // happen with real data today — but the redo code path is identical to
  // the other three hooks, so it's fixed (and tested) the same way in case
  // that constraint is ever relaxed or the row is matched differently.
  it("redo deletes the quote restored by undo, not a reference lookalike", async () => {
    setSelectHandler((sql, params) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("quote_line_items")) return [];
      if (flat.includes("WHERE id = $1")) {
        return [
          {
            id: params[0],
            reference: "D-2026-0007",
            client_id: "c1",
            project_id: null,
            status: "draft",
            language: "EN",
            activity: "design",
            activity_id: null,
            assignment: "",
            quote_date: "2026-01-01",
            valid_until: "2026-02-01",
            subtotal: 0,
            discount_applied: 0,
            discount_rate: 0,
            total: 0,
            converted_to_invoice_id: null,
            notes: "",
          },
        ];
      }
      if (flat.includes("FROM quotes")) return [];
      return [];
    });

    const { result } = renderHook(() => useDeleteQuote(), { wrapper });
    result.current.mutate(5);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];

    clearExecutedStatements();
    await action.execute(); // undo: restore, mock reports lastInsertId 1

    // Post-restore world: a DIFFERENT quote (id 999) that happens to carry
    // the same reference — the old lookup would find this one instead.
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("quote_line_items")) return [];
      if (flat.includes("FROM quotes")) {
        return [{ id: 999, reference: "D-2026-0007", client_id: "c1", status: "draft" }];
      }
      return [];
    });

    clearExecutedStatements();
    expect(action.redo).toBeDefined();
    await action.redo!(); // redo: must delete restored id 1, not the lookalike

    const del = executedStatements.find((s) => s.sql.includes("DELETE FROM quotes"));
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).not.toContain(999);
  });
});
