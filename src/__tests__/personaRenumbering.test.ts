/**
 * Runs each persona's reference renumbering against a real SQLite database.
 *
 * SQLite checks UNIQUE row by row during an UPDATE, so renumbering in place
 * failed with "UNIQUE constraint failed: quotes.reference" when the rows were
 * inserted out of date order (the music persona's quotes, UI test S0).
 */
import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { splitSeedStatements } from "../db/seeds/splitSql";

// Loaded at runtime: Vite can't bundle node:sqlite for the test environment.
const { DatabaseSync: Sqlite } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const DATA_SEEDS = import.meta.glob<string>("../db/seeds/personas/*/data.sql", { query: "?raw", import: "default", eager: true });

/** The statements from the renumbering header to the end of the file. */
function renumberingStatements(sql: string): string[] {
  const start = sql.indexOf("-- REFERENCE RENUMBERING");
  expect(start).toBeGreaterThan(0);
  return splitSeedStatements(sql.slice(start)).filter((s) => !/^PRAGMA/i.test(s.trim()));
}

function seededDb(): DatabaseSync {
  const db = new Sqlite(":memory:");
  db.exec(`
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, invoice_date TEXT);
    CREATE TABLE quotes (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, quote_date TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, invoice_date TEXT);
    CREATE TABLE income (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, date TEXT);
  `);
  // Ids out of date order, references already in the target format: row 1's
  // new number (003) is held by row 3 until row 3 is renumbered.
  const dates = ["2026-03-01", "2026-01-01", "2026-04-01", "2026-02-01", "2026-05-01"];
  dates.forEach((d, i) => {
    const n = String(i + 1).padStart(3, "0");
    db.prepare("INSERT INTO invoices VALUES (?, ?, ?)").run(i + 1, `2026-${n}`, d);
    db.prepare("INSERT INTO quotes VALUES (?, ?, ?)").run(i + 1, `D-2026-${n}`, d);
    db.prepare("INSERT INTO expenses VALUES (?, ?, ?)").run(i + 1, `F-26-${n}`, d);
    db.prepare("INSERT INTO income VALUES (?, ?, ?)").run(i + 1, `R-26-${n}`, d);
  });
  db.prepare("INSERT INTO invoices VALUES (?, ?, ?)").run(6, "DRAFT-abc", "2026-01-15");
  db.prepare("INSERT INTO quotes VALUES (?, ?, ?)").run(6, "DRAFT-q", "2026-01-15");
  return db;
}

const refs = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT reference FROM ${table} ORDER BY id`).all() as { reference: string }[]).map((r) => r.reference);

describe.each(Object.entries(DATA_SEEDS))("reference renumbering in %s", (_path, sql) => {
  it("numbers rows by date even when they were inserted out of order", () => {
    const db = seededDb();
    for (const stmt of renumberingStatements(sql)) db.exec(stmt + ";");
    expect(refs(db, "invoices")).toEqual(["2026-003", "2026-001", "2026-004", "2026-002", "2026-005", "DRAFT-abc"]);
    expect(refs(db, "quotes")).toEqual(["D-2026-003", "D-2026-001", "D-2026-004", "D-2026-002", "D-2026-005", "DRAFT-q"]);
    expect(refs(db, "expenses")).toEqual(["F-26-003", "F-26-001", "F-26-004", "F-26-002", "F-26-005"]);
    expect(refs(db, "income")).toEqual(["R-26-003", "R-26-001", "R-26-004", "R-26-002", "R-26-005"]);
  });
});
