import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A real SQLite (src-tauri migrations + ensureSchema) in place of the plugin
// mock: an Undo is only right if the rows, their ids and whatever pointed at
// them come back, and only a real database applies the ON DELETE actions.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { snapshotRows, snapshotLinks, pushRestore } from "../db/undoRestore";
import { useDeleteInvoiceTemplate } from "../db/hooks/useInvoiceTemplates";
import { useDeleteRecurringTemplate } from "../db/hooks/useRecurring";
import { useDeleteWikiArticle } from "../db/hooks/useWiki";
import { useDeleteProjectTable, useDeleteProjectTableColumn, useUpdateProjectTable } from "../db/hooks/useProjectTables";
import { useDeleteWorkloadTemplate, useDeleteWorkloadTemplateColumn, useUpdateWorkloadTemplate } from "../db/hooks/useWorkload";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";

const OLD = "2020-01-02 03:04:05";
const OLDER = "2019-05-06 07:08:09";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function hook<T>(fn: () => T): T {
  return renderHook(fn, { wrapper }).result.current;
}

/** Raw SQL against the test database; `$1` placeholders as in the app. */
const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const one = (sql: string, ...params: (string | number | null)[]) =>
  prep(sql).get(...params) as Record<string, unknown> | undefined;
const all = (sql: string, ...params: (string | number | null)[]) =>
  prep(sql).all(...params) as Record<string, unknown>[];
const run = (sql: string, ...params: (string | number | null)[]) => prep(sql).run(...params);

async function undoTop() {
  const action = useUndoStore.getState().stack[0];
  expect(action, "an undo entry was pushed").toBeDefined();
  await action.execute();
  return action;
}

beforeEach(async () => {
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  await freshRealDb();
  run("INSERT INTO clients (id, name) VALUES ('c1', 'ACME')");
  run("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Site')");
});

/** A template (id 7) used by two invoices and a quote, plus an unrelated invoice. */
function seedInvoiceTemplate() {
  run(
    "INSERT INTO invoice_templates (id, name, accent_color, created_at, updated_at) VALUES (7, 'Blue', '#0000ff', $1, $2)",
    OLDER,
    OLD
  );
  run("INSERT INTO invoices (id, reference, client_id, template_id, updated_at) VALUES (11, 'F-1', 'c1', 7, $1)", OLD);
  run("INSERT INTO invoices (id, reference, client_id, template_id, updated_at) VALUES (12, 'F-2', 'c1', 7, $1)", OLD);
  run("INSERT INTO invoices (id, reference, client_id, template_id) VALUES (13, 'F-3', 'c1', NULL)");
  run("INSERT INTO quotes (id, reference, client_id, template_id) VALUES (21, 'D-1', 'c1', 7)");
}

describe("pushRestore on a real database", () => {
  it("puts back the row, its children and the links ON DELETE SET NULL cut, with the same ids, order and dates", async () => {
    seedInvoiceTemplate();
    run("INSERT INTO project_tables (id, project_id, name, sort_order, created_at) VALUES (5, 1, 'Shots', 3, $1)", OLD);
    run("INSERT INTO project_table_rows (id, table_id, data, sort_order) VALUES (50, 5, '{\"a\":1}', 4)");
    run("INSERT INTO project_table_rows (id, table_id, data, sort_order) VALUES (51, 5, '{\"a\":2}', 2)");

    const snap = await snapshotRows([
      { table: "invoice_templates", where: "id = $1", params: [7] },
      { table: "project_tables", where: "id = $1", params: [5] },
      { table: "project_table_rows", where: "table_id = $1", params: [5] },
    ]);
    const links = await snapshotLinks([
      { table: "invoices", column: "template_id", id: 7 },
      { table: "quotes", column: "template_id", id: 7 },
    ]);
    run("DELETE FROM invoice_templates WHERE id = 7");
    run("DELETE FROM project_tables WHERE id = 5"); // rows cascade
    expect(one("SELECT template_id FROM invoices WHERE id = 11")?.template_id).toBeNull();
    expect(all("SELECT id FROM project_table_rows WHERE table_id = 5")).toHaveLength(0);

    const invalidate = vi.fn();
    expect(pushRestore("restore", snap, { redo: async () => {}, invalidate, extra: links })).toBe(true);
    await useUndoStore.getState().stack[0].execute();

    expect(one("SELECT * FROM invoice_templates WHERE id = 7")).toMatchObject({ name: "Blue", created_at: OLDER, updated_at: OLD });
    expect(all("SELECT id, template_id, updated_at FROM invoices ORDER BY id")).toEqual([
      { id: 11, template_id: 7, updated_at: OLD },
      { id: 12, template_id: 7, updated_at: OLD },
      { id: 13, template_id: null, updated_at: expect.any(String) },
    ]);
    expect(one("SELECT template_id FROM quotes WHERE id = 21")?.template_id).toBe(7);
    expect(one("SELECT * FROM project_tables WHERE id = 5")).toMatchObject({ sort_order: 3, created_at: OLD });
    expect(all("SELECT id, sort_order FROM project_table_rows WHERE table_id = 5 ORDER BY id")).toEqual([
      { id: 50, sort_order: 4 },
      { id: 51, sort_order: 2 },
    ]);
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("A3 invoice and recurring templates", () => {
  it("Undo of an invoice template delete puts its invoices and quotes back on it", async () => {
    seedInvoiceTemplate();
    await hook(() => useDeleteInvoiceTemplate()).mutateAsync(7);
    expect(one("SELECT COUNT(*) AS n FROM invoices WHERE template_id = 7")?.n).toBe(0);

    const action = await undoTop();

    expect(one("SELECT created_at FROM invoice_templates WHERE id = 7")?.created_at).toBe(OLDER);
    expect(all("SELECT id FROM invoices WHERE template_id = 7 ORDER BY id").map((r) => r.id)).toEqual([11, 12]);
    expect(one("SELECT template_id FROM invoices WHERE id = 13")?.template_id).toBeNull();
    expect(one("SELECT template_id FROM quotes WHERE id = 21")?.template_id).toBe(7);

    await action.redo!();
    expect(one("SELECT id FROM invoice_templates WHERE id = 7")).toBeUndefined();
  });

  it("Undo of a recurring template delete keeps its id and dates", async () => {
    run("INSERT INTO invoices (id, reference, client_id) VALUES (11, 'F-1', 'c1')");
    run(
      "INSERT INTO recurring_invoice_templates (id, base_invoice_id, client_id, next_due, created_at) VALUES (4, 11, 'c1', '2026-12-01', $1)",
      OLD
    );
    await hook(() => useDeleteRecurringTemplate()).mutateAsync(4);
    const action = await undoTop();
    expect(one("SELECT * FROM recurring_invoice_templates")).toMatchObject({ id: 4, next_due: "2026-12-01", created_at: OLD });
    await action.redo!();
    expect(all("SELECT id FROM recurring_invoice_templates")).toHaveLength(0);
  });
});

describe("A7 wiki articles and project tables", () => {
  it("Undo of an article delete brings back the same id, order, dates and tags", async () => {
    run(
      "INSERT INTO wiki_articles (id, title, content, sort_order, created_at, updated_at) VALUES (9, 'Brief', '<p>x</p>', 7, $1, $2)",
      OLDER,
      OLD
    );
    run("INSERT INTO wiki_article_tags (article_id, tag) VALUES (9, 'a'), (9, 'b')");

    await hook(() => useDeleteWikiArticle()).mutateAsync(9);
    const action = await undoTop();

    expect(one("SELECT * FROM wiki_articles")).toMatchObject({ id: 9, title: "Brief", content: "<p>x</p>", sort_order: 7, created_at: OLDER, updated_at: OLD });
    expect(all("SELECT tag FROM wiki_article_tags WHERE article_id = 9 ORDER BY tag").map((r) => r.tag)).toEqual(["a", "b"]);
    await action.redo!();
    expect(all("SELECT id FROM wiki_articles")).toHaveLength(0);
  });

  it("Undo of a project table delete brings back the table and its rows with their ids and order", async () => {
    run("INSERT INTO project_tables (id, project_id, name, sort_order, created_at) VALUES (5, 1, 'Shots', 3, $1)", OLD);
    run("INSERT INTO project_table_rows (id, table_id, data, sort_order) VALUES (50, 5, '{\"a\":1}', 4)");
    run("INSERT INTO project_table_rows (id, table_id, data, sort_order) VALUES (51, 5, '{\"a\":2}', 2)");

    await hook(() => useDeleteProjectTable(1)).mutateAsync(5);
    const action = await undoTop();

    expect(one("SELECT * FROM project_tables")).toMatchObject({ id: 5, name: "Shots", sort_order: 3, created_at: OLD });
    expect(all("SELECT id, data, sort_order FROM project_table_rows ORDER BY id")).toEqual([
      { id: 50, data: '{"a":1}', sort_order: 4 },
      { id: 51, data: '{"a":2}', sort_order: 2 },
    ]);
    await action.redo!();
    expect(all("SELECT id FROM project_tables")).toHaveLength(0);
  });
});

describe("A8 workload templates and columns", () => {
  it("Undo of a workload template delete leaves projects.workload_template_id pointing at a template", async () => {
    run("INSERT INTO workload_templates (id, name, columns, created_at) VALUES (8, 'Video', '[]', $1)", OLD);
    run("UPDATE projects SET workload_template_id = 8 WHERE id = 1");

    await hook(() => useDeleteWorkloadTemplate()).mutateAsync(8);
    const action = await undoTop();

    const pointed = one("SELECT workload_template_id AS t FROM projects WHERE id = 1")?.t;
    expect(one("SELECT * FROM workload_templates WHERE id = $1", pointed as number)).toMatchObject({ name: "Video", created_at: OLD });
    await action.redo!();
    expect(one("SELECT id FROM workload_templates WHERE id = 8")).toBeUndefined();
  });

  it("project table: delete column A, add B, Undo → A is back and B is kept", async () => {
    const A = { id: "a", name: "A", type: "text" };
    const C = { id: "c", name: "C", type: "number" };
    run("INSERT INTO project_tables (id, project_id, name, column_config) VALUES (5, 1, 'T', $1)", JSON.stringify([A, C]));

    await hook(() => useDeleteProjectTableColumn(1)).mutateAsync({ tableId: 5, colId: "a" });
    const B = { id: "b", name: "B", type: "date" };
    await hook(() => useUpdateProjectTable(1)).mutateAsync({ id: 5, data: { column_config: [C, B] as never } });
    const action = await undoTop();

    const cols = () => JSON.parse(String(one("SELECT column_config FROM project_tables WHERE id = 5")?.column_config));
    expect(cols()).toEqual([A, C, B]);
    await action.redo!();
    expect(cols()).toEqual([C, B]);
  });

  it("workload template: delete column A, add B, Undo → A is back and B is kept", async () => {
    const A = { key: "a", name: "A", type: "text" };
    const C = { key: "c", name: "C", type: "number" };
    run("INSERT INTO workload_templates (id, name, columns) VALUES (8, 'Video', $1)", JSON.stringify([A, C]));

    await hook(() => useDeleteWorkloadTemplateColumn()).mutateAsync({ templateId: 8, key: "a" });
    const B = { key: "b", name: "B", type: "checkbox" };
    await hook(() => useUpdateWorkloadTemplate()).mutateAsync({ id: 8, columns: [C, B] as never });
    const action = await undoTop();

    const cols = () => JSON.parse(String(one("SELECT columns FROM workload_templates WHERE id = 8")?.columns));
    expect(cols()).toEqual([A, C, B]);
    await action.redo!();
    expect(cols()).toEqual([C, B]);
  });
});
