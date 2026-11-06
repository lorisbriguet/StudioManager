import { describe, it, expect, beforeEach, vi } from "vitest";

// A real SQLite (src-tauri migrations + ensureSchema) behind the app's own
// createBackup / restoreFromBackup, with an in-memory filesystem. Only a real
// database knows every table and fires the ON DELETE actions a restore hits.
const memfs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array | string>(),
  dirs: new Set<string>(),
  reset() {
    this.files.clear();
    this.dirs.clear();
  },
}));

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));
// plugin-fs, api/core and api/path all alias to one mock module (vitest.config.ts),
// so this one factory supplies `invoke` (the Rust batch) and the filesystem.
vi.mock("@tauri-apps/plugin-fs", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
  mkdir: async (p: string) => {
    memfs.dirs.add(p);
  },
  writeFile: async (p: string, data: Uint8Array) => {
    memfs.files.set(p, data);
  },
  readTextFile: async (p: string) => {
    const v = memfs.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return typeof v === "string" ? v : new TextDecoder().decode(v);
  },
  exists: async (p: string) =>
    memfs.files.has(p) || memfs.dirs.has(p) || [...memfs.files.keys(), ...memfs.dirs].some((k) => k.startsWith(`${p}/`)),
  readDir: async (p: string) => {
    const names = new Map<string, boolean>();
    for (const k of [...memfs.files.keys(), ...memfs.dirs]) {
      if (!k.startsWith(`${p}/`)) continue;
      const rest = k.slice(p.length + 1);
      const isFile = !rest.includes("/") && memfs.files.has(k);
      const name = rest.split("/")[0];
      if (!names.has(name) || !isFile) names.set(name, isFile);
    }
    return [...names].map(([name, isFile]) => ({ name, isFile, isDirectory: !isFile }));
  },
  copyFile: async (src: string, dest: string) => {
    const v = memfs.files.get(src);
    if (v === undefined) throw new Error(`ENOENT: ${src}`);
    memfs.files.set(dest, v);
  },
  remove: async (p: string) => {
    memfs.dirs.delete(p);
    for (const k of [...memfs.files.keys()]) if (k === p || k.startsWith(`${p}/`)) memfs.files.delete(k);
  },
  appDataDir: async () => "/appdata",
}));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { TABLES, NOT_BACKED_UP, createBackup, restoreFromBackup } from "../lib/backup";
import { useOrgStore } from "../stores/org-store";

const count = (table: string) => (rawDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(async () => {
  memfs.reset();
  useOrgStore.setState({ activeId: "" });
  await freshRealDb();
});

describe("backup TABLES against the real schema", () => {
  it("lists every table the migrations and ensureSchema create", () => {
    const tables = (
      rawDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
    const missing = tables.filter((t) => !TABLES.includes(t) && !NOT_BACKED_UP.includes(t));
    expect(missing, "tables missing from TABLES in src/lib/backup.ts").toEqual([]);
  });

  it("lists no table that does not exist", () => {
    const exists = rawDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    expect(TABLES.filter((t) => !exists.get(t))).toEqual([]);
  });
});

describe("backup round trip", () => {
  function seed() {
    const db = rawDb();
    const { code } = db.prepare("SELECT code FROM expense_categories LIMIT 1").get() as { code: string };
    db.prepare("INSERT INTO activities (id, name_fr, name_en) VALUES (7, 'Graphisme', 'Graphic design')").run();
    db.prepare(
      "INSERT INTO expenses (id, reference, supplier, category_code, amount) VALUES (3, 'E-1', 'Printer', ?, 120)"
    ).run(code);
    db.prepare("INSERT INTO connections (id, kind, label) VALUES (5, 'paperless', 'Paperless')").run();
    db.prepare(
      "INSERT INTO paperless_links (connection_id, paperless_doc_id, expense_id, state) VALUES (5, 42, 3, 'linked')"
    ).run();
  }

  it("keeps activities and paperless links when restoring over the live database", async () => {
    seed();
    const path = await createBackup("/bk", 5);
    const { warnings } = await restoreFromBackup(path);

    expect(warnings).toEqual([]);
    expect(count("activities")).toBe(1);
    expect(rawDb().prepare("SELECT name_en FROM activities WHERE id = 7").get()).toEqual({ name_en: "Graphic design" });
    expect(rawDb().prepare("SELECT connection_id, paperless_doc_id, expense_id FROM paperless_links").all()).toEqual([
      { connection_id: 5, paperless_doc_id: 42, expense_id: 3 },
    ]);
  });

  it("brings activities and paperless links back into an empty database", async () => {
    seed();
    const path = await createBackup("/bk", 5);
    const backup = new Map(memfs.files);

    await freshRealDb();
    for (const [k, v] of backup) memfs.files.set(k, v);
    const { warnings } = await restoreFromBackup(path);

    expect(warnings).toEqual([]);
    expect(count("activities")).toBe(1);
    expect(count("paperless_links")).toBe(1);
  });
});
