import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createBackup, restoreFromBackup, RestoreError } from "../lib/backup";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// In-memory filesystem: plugin-fs and api/path both alias to the same
// catch-all mock module, so ONE vi.mock supplies every export both use.
const memfs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array | string>(),
  dirs: new Set<string>(),
  removed: [] as string[],
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.removed.length = 0;
  },
}));

// backup.ts logs progress via plugin-log, which needs the real Tauri bridge
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", async () => ({
  // TransactionBatch resolves `invoke` from the same catch-all module —
  // forward batch statements to the shared SQL log like the real mock does.
  invoke: vi.fn(async (cmd: string, args?: { statements?: { sql: string; params: unknown[] }[] }) => {
    if (cmd === "execute_batch" && Array.isArray(args?.statements)) {
      const { executedStatements: log } = await import("../__mocks__/tauri-sql");
      for (const stmt of args.statements) log.push({ sql: stmt.sql, params: stmt.params });
      return { lastInsertId: 1 };
    }
    return null;
  }),
  mkdir: vi.fn(async (p: string) => {
    memfs.dirs.add(p);
  }),
  writeFile: vi.fn(async (p: string, data: Uint8Array) => {
    memfs.files.set(p, data);
  }),
  readTextFile: vi.fn(async (p: string) => {
    const v = memfs.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return typeof v === "string" ? v : new TextDecoder().decode(v);
  }),
  exists: vi.fn(
    async (p: string) =>
      memfs.files.has(p) ||
      memfs.dirs.has(p) ||
      [...memfs.files.keys(), ...memfs.dirs].some((k) => k.startsWith(`${p}/`))
  ),
  readDir: vi.fn(async (p: string) => {
    const names = new Map<string, { isFile: boolean }>();
    for (const k of [...memfs.files.keys(), ...memfs.dirs]) {
      if (!k.startsWith(`${p}/`)) continue;
      const rest = k.slice(p.length + 1);
      const name = rest.split("/")[0];
      const isFile = !rest.includes("/") && memfs.files.has(k);
      if (!names.has(name) || isFile === false) names.set(name, { isFile });
    }
    return [...names.entries()].map(([name, m]) => ({
      name,
      isFile: m.isFile,
      isDirectory: !m.isFile,
    }));
  }),
  copyFile: vi.fn(async (src: string, dest: string) => {
    const v = memfs.files.get(src);
    if (v === undefined) throw new Error(`ENOENT: ${src}`);
    memfs.files.set(dest, v);
  }),
  remove: vi.fn(async (p: string) => {
    memfs.removed.push(p);
    memfs.dirs.delete(p);
    for (const k of [...memfs.files.keys()]) {
      if (k === p || k.startsWith(`${p}/`)) memfs.files.delete(k);
    }
    for (const d of [...memfs.dirs]) {
      if (d.startsWith(`${p}/`)) memfs.dirs.delete(d);
    }
  }),
  appDataDir: vi.fn(async () => "/appdata"),
}));

const fileText = (path: string): string => {
  const v = memfs.files.get(path);
  if (v === undefined) throw new Error(`missing file ${path}`);
  return typeof v === "string" ? v : new TextDecoder().decode(v);
};

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  memfs.reset();
  clearExecutedStatements();
  setSelectHandler(null);
});

describe("createBackup", () => {
  it("writes one CSV per non-empty table and copies receipt files", async () => {
    setSelectHandler((sql) => {
      if (sql.includes("SELECT * FROM clients")) {
        return [{ id: "C-001", name: "ACME, Inc", notes: 'has "quotes"' }];
      }
      return [];
    });
    memfs.files.set("/appdata/receipts/r1.pdf", new Uint8Array([9]));

    const path = await createBackup("/backups", 5);

    expect(path.startsWith("/backups/backup-")).toBe(true);
    const csv = fileText(`${path}/data/clients.csv`);
    expect(csv.split("\n")[0]).toBe("id,name,notes");
    expect(csv).toContain('"ACME, Inc"'); // commas survive CSV escaping
    expect(memfs.files.has(`${path}/receipts/r1.pdf`)).toBe(true);
    // Empty tables produce no file
    expect(memfs.files.has(`${path}/data/expenses.csv`)).toBe(false);
  });

  it("rotates the oldest backups beyond the limit", async () => {
    memfs.dirs.add("/backups/backup-2020-01-01-00-00-00/data");
    memfs.dirs.add("/backups/backup-2021-01-01-00-00-00/data");
    await createBackup("/backups", 2);
    // 3 backups exist now, limit 2 -> only the 2020 one is removed
    expect(memfs.removed).toContain("/backups/backup-2020-01-01-00-00-00");
    expect(memfs.removed).not.toContain("/backups/backup-2021-01-01-00-00-00");
  });

  it("retries a rotation delete that fails transiently (synced-folder ENOTEMPTY)", async () => {
    vi.useFakeTimers();
    try {
      memfs.dirs.add("/backups/backup-2020-01-01-00-00-00/data");
      memfs.dirs.add("/backups/backup-2021-01-01-00-00-00/data");
      const fs = await import("@tauri-apps/plugin-fs");
      const realRemove = vi.mocked(fs.remove).getMockImplementation()!;
      let failures = 0;
      vi.mocked(fs.remove).mockImplementation(async (p, opts) => {
        if (String(p).endsWith("backup-2020-01-01-00-00-00") && failures < 2) {
          failures++;
          throw new Error(
            "failed to remove path: /backups/backup-2020-01-01-00-00-00 with error: Directory not empty (os error 66)"
          );
        }
        return realRemove(p, opts);
      });

      const pending = createBackup("/backups", 2);
      await vi.advanceTimersByTimeAsync(60000);
      await pending;

      expect(failures).toBe(2); // two transient failures were retried through
      expect(memfs.removed).toContain("/backups/backup-2020-01-01-00-00-00");
      vi.mocked(fs.remove).mockImplementation(realRemove);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with a warning when a rotation delete keeps failing", async () => {
    vi.useFakeTimers();
    try {
      memfs.dirs.add("/backups/backup-2020-01-01-00-00-00/data");
      memfs.dirs.add("/backups/backup-2021-01-01-00-00-00/data");
      const fs = await import("@tauri-apps/plugin-fs");
      const realRemove = vi.mocked(fs.remove).getMockImplementation()!;
      let attempts = 0;
      vi.mocked(fs.remove).mockImplementation(async (p, opts) => {
        if (String(p).endsWith("backup-2020-01-01-00-00-00")) {
          attempts++;
          throw new Error("Directory not empty (os error 66)");
        }
        return realRemove(p, opts);
      });

      const pending = createBackup("/backups", 2);
      await vi.advanceTimersByTimeAsync(60000);
      // createBackup must still resolve — rotation failure is non-fatal
      const path = await pending;
      expect(path.startsWith("/backups/backup-")).toBe(true);

      expect(attempts).toBeGreaterThanOrEqual(3); // exhausted retries
      expect(memfs.removed).not.toContain("/backups/backup-2020-01-01-00-00-00");
      const { logWarn } = await import("../lib/log");
      expect(vi.mocked(logWarn)).toHaveBeenCalledWith(
        expect.stringContaining("backup-2020-01-01-00-00-00"),
        expect.anything()
      );
      vi.mocked(fs.remove).mockImplementation(realRemove);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("restoreFromBackup", () => {
  const seedBackup = () => {
    memfs.files.set("/bk/backup-X/data/clients.csv", 'id,name\nC-001,"ACME, Inc"');
  };

  const restoreSelectHandler = (sql: string) => {
    if (sql.includes("pragma_table_info('clients')")) {
      return [
        { name: "id", notnull: 1, dflt_value: null, type: "TEXT" },
        { name: "name", notnull: 1, dflt_value: null, type: "TEXT" },
      ];
    }
    if (sql.includes("COUNT(*)")) {
      return [{ cnt: sql.includes("FROM clients") ? 1 : 0 }];
    }
    if (sql.includes("SELECT * FROM clients")) {
      // Current (pre-restore) data — lands in the safety backup
      return [{ id: "OLD-1", name: "Old Client" }];
    }
    return [];
  };

  it("takes a safety backup, wipes children-first and re-inserts the CSV rows", async () => {
    seedBackup();
    setSelectHandler(restoreSelectHandler);

    const result = await restoreFromBackup("/bk/backup-X");

    // Safety backup of the PRE-restore data exists next to the backup
    // (returned as the folder name only)
    expect(result.safetyBackup.startsWith("backup-")).toBe(true);
    expect(result.safetyBackup).not.toBe("backup-X");
    expect(fileText(`/bk/${result.safetyBackup}/data/clients.csv`)).toContain("Old Client");

    // Deferred FKs, a full wipe, then the insert with the CSV values
    const sqls = executedStatements.map((s) => s.sql);
    expect(sqls.some((s) => s.includes("defer_foreign_keys"))).toBe(true);
    expect(sqls.filter((s) => s.startsWith("DELETE FROM")).length).toBeGreaterThan(10);
    const insert = executedStatements.find((s) => s.sql.startsWith("INSERT INTO clients"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual(["C-001", "ACME, Inc"]);
    // The wipe is ordered after the safety backup could still read old data:
    // clients DELETE must come after nothing here — order vs file writes is
    // implicit (reads happened), but the DELETE must precede the INSERT.
    expect(sqls.findIndex((s) => s === "DELETE FROM clients")).toBeLessThan(
      sqls.findIndex((s) => s.startsWith("INSERT INTO clients"))
    );
  });

  it("aborts before touching the database when the backup holds no data", async () => {
    // No CSV files at all
    setSelectHandler(restoreSelectHandler);
    await expect(restoreFromBackup("/bk/backup-empty")).rejects.toThrow(RestoreError);
    expect(executedStatements.some((s) => s.sql.startsWith("DELETE FROM"))).toBe(false);
    // No safety backup was created either — nothing was worth protecting
    expect([...memfs.dirs].some((d) => d.includes("/bk/backup-") && d.includes("data") && !d.includes("backup-empty"))).toBe(false);
  });
});
