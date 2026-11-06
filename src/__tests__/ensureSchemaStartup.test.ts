import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A real SQLite (src-tauri migrations + ensureSchema). Every statement the
// startup sends is an IPC round trip in the app. The schema comes from the
// migrations only: the startup sends no schema statement, just the seeds
// (once) and the data repairs.
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

import { RealDatabase, freshRealDb } from "./fixtures/realSqlite";
import { closeDb, getDb } from "../db/index";

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
  sent.filter((s) => /CREATE (TABLE|INDEX)|ALTER TABLE|DROP INDEX|pragma_table_info|sqlite_master/i.test(s));

beforeEach(async () => {
  await freshRealDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureSchema at startup", () => {
  it("sends no schema statement", async () => {
    const sent = await restart();
    expect(schemaStatements(sent)).toEqual([]);
    // Was about 100 round trips; what is left are the data repairs.
    expect(sent.length).toBeLessThanOrEqual(10);
  });
});
