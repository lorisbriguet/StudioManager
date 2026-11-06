import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A real SQLite (src-tauri migrations + ensureSchema). Every statement the
// startup sends is an IPC round trip in the app: a file whose schema is
// already current must skip the schema checks, and a file that needs them
// reads its columns in one query instead of one per column.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({
  seedUserGuide: async (db: { execute: (sql: string) => Promise<unknown> }) => {
    await db.execute("INSERT INTO wiki_folders (name) VALUES ('User Guide')");
  },
}));

import { RealDatabase, freshRealDb, rawDb } from "./fixtures/realSqlite";
import { closeDb, getDb, SCHEMA_FIXUPS_VERSION } from "../db/index";

const stamp = () =>
  (rawDb().prepare("SELECT value FROM meta WHERE key = 'schema_fixups'").get() as { value: string } | undefined)?.value;
const hasIndex = (name: string) =>
  rawDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) !== undefined;
const columns = (table: string) =>
  (rawDb().prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((r) => r.name);

/** Reopen the connection (as at app start) and return every statement sent. */
async function restart(): Promise<string[]> {
  await closeDb();
  const sent: string[] = [];
  const select = RealDatabase.prototype.select;
  const execute = RealDatabase.prototype.execute;
  vi.spyOn(RealDatabase.prototype, "select").mockImplementation(function (this: RealDatabase, sql, params) {
    sent.push(sql);
    return select.call(this, sql, params) as never;
  });
  vi.spyOn(RealDatabase.prototype, "execute").mockImplementation(function (this: RealDatabase, sql, params) {
    sent.push(sql);
    return execute.call(this, sql, params);
  });
  await getDb();
  vi.restoreAllMocks();
  return sent;
}

const schemaStatements = (sent: string[]) =>
  sent.filter((s) => /CREATE (TABLE|INDEX)|ALTER TABLE|pragma_table_info/i.test(s));

beforeEach(async () => {
  await freshRealDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureSchema at startup", () => {
  it("records the schema version once the schema ran", () => {
    expect(stamp()).toBe(`${SCHEMA_FIXUPS_VERSION}/0`);
  });

  it("skips every schema statement when the file is current", async () => {
    const sent = await restart();
    expect(schemaStatements(sent)).toEqual([]);
    // Was about 100 round trips; what is left are the data repairs.
    expect(sent.length).toBeLessThanOrEqual(12);
  });

  it("runs the schema again for an older version, reading columns in one query", async () => {
    rawDb().exec("UPDATE meta SET value = '0/0' WHERE key = 'schema_fixups'");
    rawDb().exec("DROP INDEX idx_tasks_due");
    rawDb().exec("ALTER TABLE tasks DROP COLUMN reminder");

    const sent = await restart();
    expect(hasIndex("idx_tasks_due")).toBe(true);
    expect(columns("tasks")).toContain("reminder");
    expect(stamp()).toBe(`${SCHEMA_FIXUPS_VERSION}/0`);
    expect(sent.filter((s) => s.includes("pragma_table_info"))).toHaveLength(1);
  });

  it("runs the schema again after a new Rust migration", async () => {
    rawDb().exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    rawDb().exec("INSERT INTO schema_migrations VALUES (13, datetime('now'))");
    rawDb().exec("DROP INDEX idx_tasks_due");

    await restart();
    expect(hasIndex("idx_tasks_due")).toBe(true);
    expect(stamp()).toBe(`${SCHEMA_FIXUPS_VERSION}/13`);

    rawDb().exec("INSERT INTO schema_migrations VALUES (14, datetime('now'))");
    expect(schemaStatements(await restart()).length).toBeGreaterThan(0);
    expect(stamp()).toBe(`${SCHEMA_FIXUPS_VERSION}/14`);
  });

  it("runs the schema again when the previous run stopped before the end", async () => {
    rawDb().exec("DELETE FROM meta WHERE key = 'schema_fixups'");
    rawDb().exec("DROP INDEX idx_quotes_client");
    await restart();
    expect(hasIndex("idx_quotes_client")).toBe(true);
  });
});
