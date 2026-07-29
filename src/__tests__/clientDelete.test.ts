import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  deleteClient,
  snapshotClientGraph,
  restoreClientGraph,
} from "../db/queries/clients";
import { getDb } from "../db";
import {
  executedStatements,
  clearExecutedStatements,
  setSelectHandler,
} from "../__mocks__/tauri-sql";

// Pinned FK-safe cascade: circular-FK break first, then children before
// parents. If deleteClient changes, this list MUST be updated consciously.
const CASCADE_SQL = [
  "UPDATE quotes SET converted_to_invoice_id = NULL WHERE client_id = $1",
  "DELETE FROM recurring_invoice_templates WHERE client_id = $1",
  "DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = $1)",
  "DELETE FROM invoices WHERE client_id = $1",
  "DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE client_id = $1)",
  "DELETE FROM quotes WHERE client_id = $1",
  "DELETE FROM time_entries WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)",
  "DELETE FROM subtasks WHERE task_id IN (SELECT id FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))",
  "DELETE FROM workload_rows WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)",
  "DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)",
  "DELETE FROM project_table_rows WHERE table_id IN (SELECT id FROM project_tables WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))",
  "DELETE FROM project_tables WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)",
  "DELETE FROM resource_projects WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)",
  "DELETE FROM projects WHERE client_id = $1",
  "DELETE FROM client_contacts WHERE client_id = $1",
  "DELETE FROM client_addresses WHERE client_id = $1",
  "DELETE FROM clients WHERE id = $1",
];

describe("deleteClient cascade", () => {
  beforeAll(async () => {
    // Warm the DB singleton so ensureSchema noise doesn't pollute the SQL log
    await getDb();
  });

  beforeEach(() => {
    setSelectHandler(null);
    clearExecutedStatements();
  });

  it("executes the complete cascade in FK-safe children-first order", async () => {
    await deleteClient("C-001");
    expect(executedStatements.map((s) => s.sql)).toEqual(CASCADE_SQL);
    for (const s of executedStatements) {
      expect(s.params).toEqual(["C-001"]);
    }
  });

  it("breaks the circular quotes<->invoices FK as the very first statement", async () => {
    await deleteClient("C-001");
    expect(executedStatements[0]?.sql).toBe(
      "UPDATE quotes SET converted_to_invoice_id = NULL WHERE client_id = $1"
    );
  });
});

describe("client graph snapshot -> restore round trip", () => {
  const client = { id: "C-001", name: "Acme", language: "EN" };
  const contacts = [{ id: 11, client_id: "C-001", first_name: "Ada", last_name: "L" }];
  const addresses = [{ id: 21, client_id: "C-001", label: "Main" }];
  const projects = [{ id: 31, client_id: "C-001", name: "Site" }];
  const tasks = [{ id: 41, project_id: 31, title: "Design" }];
  const subtasks = [{ id: 51, task_id: 41, title: "Logo" }];
  // Circular pair: quote 61 converted to invoice 71, invoice 71 from quote 61
  const invoices = [{ id: 71, client_id: "C-001", reference: "2026-001", from_quote_id: 61, contact_id: 11 }];
  const invoiceLineItems = [{ id: 81, invoice_id: 71, designation: "Work" }];
  const quotes = [{ id: 61, client_id: "C-001", reference: "D-2026-001", converted_to_invoice_id: 71 }];
  const quoteLineItems = [{ id: 91, quote_id: 61, designation: "Work" }];
  const recurringTemplates = [{ id: 101, client_id: "C-001", base_invoice_id: 71 }];
  const timeEntries = [{ id: 111, project_id: 31, task_id: 41, duration_minutes: 30 }];
  const projectTables = [{ id: 121, project_id: 31, name: "Assets" }];
  const projectTableRows = [{ id: 131, table_id: 121, data: "{}" }];
  const resourceProjects = [{ resource_id: 141, project_id: 31 }];

  beforeAll(async () => {
    await getDb();
  });

  beforeEach(() => {
    setSelectHandler((sql) => {
      if (sql.startsWith("SELECT * FROM clients WHERE id")) return [client];
      if (sql.startsWith("SELECT * FROM client_contacts")) return contacts;
      if (sql.startsWith("SELECT * FROM client_addresses")) return addresses;
      if (sql.startsWith("SELECT * FROM projects")) return projects;
      if (sql.startsWith("SELECT * FROM tasks")) return tasks;
      if (sql.startsWith("SELECT * FROM subtasks")) return subtasks;
      if (sql.startsWith("SELECT * FROM invoices")) return invoices;
      if (sql.startsWith("SELECT * FROM invoice_line_items")) return invoiceLineItems;
      if (sql.startsWith("SELECT * FROM quotes")) return quotes;
      if (sql.startsWith("SELECT * FROM quote_line_items")) return quoteLineItems;
      if (sql.startsWith("SELECT * FROM recurring_invoice_templates")) return recurringTemplates;
      if (sql.startsWith("SELECT * FROM time_entries")) return timeEntries;
      if (sql.startsWith("SELECT * FROM project_tables")) return projectTables;
      if (sql.startsWith("SELECT * FROM project_table_rows")) return projectTableRows;
      if (sql.startsWith("SELECT * FROM resource_projects")) return resourceProjects;
      return [];
    });
    clearExecutedStatements();
  });

  it("returns null when the client does not exist", async () => {
    setSelectHandler(() => []);
    expect(await snapshotClientGraph("C-404")).toBeNull();
  });

  it("snapshots every cascade table and restores all rows with original IDs", async () => {
    const snap = await snapshotClientGraph("C-001");
    expect(snap).not.toBeNull();
    clearExecutedStatements();
    await restoreClientGraph(snap!);

    const sqls = executedStatements.map((s) => s.sql);
    const firstIdx = (prefix: string) =>
      sqls.findIndex((sql) => sql.startsWith(prefix));

    // Every snapshotted table gets an INSERT (workload_rows is legacy-only
    // and intentionally excluded from snapshot/restore)
    for (const table of [
      "clients",
      "client_contacts",
      "client_addresses",
      "projects",
      "tasks",
      "subtasks",
      "quotes",
      "invoices",
      "invoice_line_items",
      "quote_line_items",
      "recurring_invoice_templates",
      "time_entries",
      "project_tables",
      "project_table_rows",
      "resource_projects",
    ]) {
      expect(firstIdx(`INSERT INTO ${table} (`), table).toBeGreaterThanOrEqual(0);
    }

    // Parents before children
    expect(firstIdx("INSERT INTO clients (")).toBeLessThan(firstIdx("INSERT INTO projects ("));
    expect(firstIdx("INSERT INTO projects (")).toBeLessThan(firstIdx("INSERT INTO tasks ("));
    expect(firstIdx("INSERT INTO tasks (")).toBeLessThan(firstIdx("INSERT INTO subtasks ("));
    expect(firstIdx("INSERT INTO client_contacts (")).toBeLessThan(firstIdx("INSERT INTO invoices ("));
    expect(firstIdx("INSERT INTO invoices (")).toBeLessThan(firstIdx("INSERT INTO invoice_line_items ("));
    expect(firstIdx("INSERT INTO quotes (")).toBeLessThan(firstIdx("INSERT INTO quote_line_items ("));
    expect(firstIdx("INSERT INTO invoices (")).toBeLessThan(firstIdx("INSERT INTO recurring_invoice_templates ("));
    expect(firstIdx("INSERT INTO project_tables (")).toBeLessThan(firstIdx("INSERT INTO project_table_rows ("));

    // Circular pair: quotes inserted (with NULL pointer) BEFORE invoices,
    // then the pointer is patched AFTER invoices exist
    const quoteInsertIdx = firstIdx("INSERT INTO quotes (");
    const invoiceInsertIdx = firstIdx("INSERT INTO invoices (");
    const patchIdx = firstIdx("UPDATE quotes SET converted_to_invoice_id = $1");
    expect(quoteInsertIdx).toBeLessThan(invoiceInsertIdx);
    expect(patchIdx).toBeGreaterThan(invoiceInsertIdx);
    expect(executedStatements[patchIdx].params).toEqual([71, 61]);

    // The quote INSERT itself carries NULL for converted_to_invoice_id
    const quoteInsert = executedStatements[quoteInsertIdx];
    const quoteCols = quoteInsert.sql
      .slice(quoteInsert.sql.indexOf("(") + 1, quoteInsert.sql.indexOf(")"))
      .split(",")
      .map((c) => c.trim());
    const convIdx = quoteCols.indexOf("converted_to_invoice_id");
    expect(convIdx).toBeGreaterThanOrEqual(0);
    expect(quoteInsert.params[convIdx]).toBeNull();

    // Original IDs are preserved verbatim
    expect(executedStatements[firstIdx("INSERT INTO clients (")].params).toContain("C-001");
    expect(executedStatements[firstIdx("INSERT INTO projects (")].params).toContain(31);
    expect(executedStatements[firstIdx("INSERT INTO tasks (")].params).toContain(41);
    expect(executedStatements[invoiceInsertIdx].params).toContain(71);
    expect(executedStatements[firstIdx("INSERT INTO time_entries (")].params).toContain(111);
  });
});
