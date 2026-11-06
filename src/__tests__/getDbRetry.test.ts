import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A real SQLite (src-tauri migrations + ensureSchema). A failed open must not
// stay cached: the next getDb() tries again, and a schema run cut short
// halfway can run again cleanly (that is what the overlay's Retry does).
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../lib/log", () => ({ logError: vi.fn() }));
vi.mock("../db/seeds/user-guide", () => ({
  seedUserGuide: async (db: { execute: (sql: string) => Promise<unknown> }) => {
    await db.execute("INSERT INTO wiki_folders (name) VALUES ('User Guide')");
  },
}));

import { RealDatabase, freshRealDb, rawDb } from "./fixtures/realSqlite";
import { closeDb, getDb } from "../db/index";

const SEEDED = ["resources", "dashboard_presets", "workload_templates", "invoice_templates", "wiki_folders"];
const counts = () =>
  Object.fromEntries(
    SEEDED.map((t) => [t, (rawDb().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  );

beforeEach(async () => {
  await freshRealDb();
  await closeDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll(".db-fatal").forEach((el) => el.remove());
});

describe("getDb after a failure", () => {
  it("tries again when opening the database failed once (database busy)", async () => {
    const load = vi.spyOn(RealDatabase, "load").mockRejectedValueOnce(new Error("database is locked"));
    await expect(getDb()).rejects.toThrow("database is locked");
    await expect(getDb()).resolves.toBeInstanceOf(RealDatabase);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("runs the startup again after it stopped halfway, without doubling the seed data", async () => {
    const before = counts();
    // Make the seeds due again, as on a new file.
    rawDb().exec("DELETE FROM meta WHERE key LIKE 'seeded:%'");
    for (const t of SEEDED) rawDb().exec(`DELETE FROM ${t}`);
    const execute = RealDatabase.prototype.execute;
    vi.spyOn(RealDatabase.prototype, "execute").mockImplementation(function (this: RealDatabase, sql, params) {
      if (sql.includes("INSERT INTO dashboard_presets")) throw new Error("disk I/O error");
      return execute.call(this, sql, params);
    });
    await expect(getDb()).rejects.toThrow("disk I/O error");
    expect(rawDb().prepare("SELECT 1 FROM meta WHERE key = 'seeded:resources'").get()).toBeDefined();
    expect(rawDb().prepare("SELECT 1 FROM meta WHERE key = 'seeded:dashboard_presets'").get()).toBeUndefined();

    vi.mocked(RealDatabase.prototype.execute).mockRestore();
    await expect(getDb()).resolves.toBeInstanceOf(RealDatabase);
    expect(counts()).toEqual(before);
  });

  it("keeps the new connection cached after a switch waited on a failed attempt", async () => {
    let failOld!: (e: Error) => void;
    const load = vi.spyOn(RealDatabase, "load").mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }));
    const old = getDb();
    const closing = closeDb(); // organisation switch: waits on the old attempt
    failOld(new Error("database is locked"));
    await expect(old).rejects.toThrow();
    await closing;
    const fresh = await getDb();
    expect(await getDb()).toBe(fresh);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
