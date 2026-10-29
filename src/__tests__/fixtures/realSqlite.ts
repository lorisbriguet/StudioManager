/**
 * A real SQLite database for tests (node:sqlite, in memory), wired in place of
 * the Tauri SQL plugin and the Rust `execute_batch` command. It runs the real
 * migrations (src-tauri/migrations) and then the app's own `ensureSchema`
 * (through getDb), so constraints, defaults and `ON DELETE` actions are the
 * shipped ones. Use it where the mock (src/__mocks__/tauri-sql.ts) can't
 * tell: restores, cascades, links between rows.
 *
 *   vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
 *   vi.mock("@tauri-apps/api/core", async (orig) => ({ ...(await orig<object>()), invoke: (await import("./fixtures/realSqlite")).realInvoke }));
 *   vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));
 *
 *   beforeEach(() => freshRealDb());   // then getDb() opens it
 */
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Vite can't bundle node:sqlite for the DOM test environment; take it from Node at run time.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncT;

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../src-tauri/migrations");

let current: DatabaseSync | null = null;

/** The raw connection, for arranging and asserting outside the app's queries. */
export function rawDb(): DatabaseSync {
  if (!current) throw new Error("freshRealDb() first");
  return current;
}

/** A new empty database with every migration and the app's ensureSchema applied. */
export async function freshRealDb(): Promise<DatabaseSync> {
  // Imported here, not at the top: the vi.mock factories import this file
  // while db/index is still waiting on them.
  const { closeDb, getDb } = await import("../../db/index");
  await closeDb();
  const db = new DatabaseSync(":memory:");
  // sqlx (the Tauri SQL plugin) and the Rust batch both turn foreign keys on.
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec("BEGIN");
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    db.exec("COMMIT");
  }
  current = db;
  await getDb(); // runs ensureSchema on it
  return db;
}

/** `$1` → `?1`, outside string literals (as the Rust batch does). */
function toSqlite(sql: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") inString = !inString;
    if (!inString && c === "$" && /\d/.test(sql[i + 1] ?? "")) {
      out += "?";
      continue;
    }
    out += c;
  }
  return out;
}

type SqlValue = null | number | bigint | string | Uint8Array;

function bind(params: unknown[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (typeof p === "number" || typeof p === "bigint" || typeof p === "string" || p instanceof Uint8Array) return p;
    return JSON.stringify(p);
  });
}

function run(sql: string, params: unknown[]): { rowsAffected: number; lastInsertId: number } {
  const r = rawDb().prepare(toSqlite(sql)).run(...bind(params));
  return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
}

/** Stands in for `@tauri-apps/plugin-sql`'s Database. */
export class RealDatabase {
  static async load(): Promise<RealDatabase> {
    return new RealDatabase();
  }
  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = rawDb().prepare(toSqlite(sql)).all(...bind(params));
    return rows.map((r) => ({ ...r })) as T;
  }
  async execute(sql: string, params: unknown[] = []) {
    return run(sql, params);
  }
  async close(): Promise<boolean> {
    return true;
  }
}

/** Stands in for `invoke`: `execute_batch` runs in one transaction, as in src-tauri/src/lib.rs. */
export async function realInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (cmd !== "execute_batch") return null;
  const statements = args.statements as { sql: string; params: unknown[] }[];
  const db = rawDb();
  let lastInsertId = 0;
  db.exec("BEGIN");
  try {
    for (const s of statements) {
      const usesParent = s.sql.includes("$LAST_INSERT_ID");
      const r = run(s.sql.replace("$LAST_INSERT_ID", String(lastInsertId)), s.params ?? []);
      if (!usesParent) lastInsertId = r.lastInsertId;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { lastInsertId };
}
