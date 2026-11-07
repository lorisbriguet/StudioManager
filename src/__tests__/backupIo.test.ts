import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import * as fsMock from "@tauri-apps/plugin-fs";
import {
  createBackup,
  restoreFromBackup,
  RestoreError,
  listBackups,
  backupsToRemove,
  KEEP_RECENT,
  KEEP_HOURS,
  KEEP_DAILY,
  KEEP_MONTHLY,
  TABLES,
} from "../lib/backup";
import { getDb } from "../db";
import { useOrgStore } from "../stores/org-store";
import type { Organisation } from "../lib/orgs";
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
  /** Organisations whose backup the fake create_backups command fails. */
  failOrgs: new Set<string>(),
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.removed.length = 0;
    this.failOrgs.clear();
  },
}));

// backup.ts logs progress via plugin-log, which needs the real Tauri bridge
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", async () => {
  return {
    // TransactionBatch resolves `invoke` from the same catch-all module —
    // forward batch statements to the shared SQL log like the real mock does.
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "create_backups") {
        // Imported on first use: the fixture imports backup.ts, which
        // imports this mocked module.
        const { fakeCreateBackups } = await import("./fixtures/fakeBackupCommand");
        const { getDb: db } = await import("../db");
        const createBackups = fakeCreateBackups(memfs, {
          rows: async (table) => (await db()).select(`SELECT * FROM ${table}`),
          failOrgs: memfs.failOrgs,
        });
        return createBackups(args as Parameters<typeof createBackups>[0]);
      }
      const statements = args?.statements as { sql: string; params: unknown[] }[] | undefined;
      if (cmd === "execute_batch" && Array.isArray(statements)) {
        const { executedStatements: log } = await import("../__mocks__/tauri-sql");
        for (const stmt of statements) log.push({ sql: stmt.sql, params: stmt.params });
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
  };
});

const fileText = (path: string): string => {
  const v = memfs.files.get(path);
  if (v === undefined) throw new Error(`missing file ${path}`);
  return typeof v === "string" ? v : new TextDecoder().decode(v);
};

// Stub readDir for a directory to a fixed list of child folder names, without
// needing to seed nested files/dirs under each one individually.
const setReadDirEntries = (dir: string, names: string[]): void => {
  for (const name of names) memfs.dirs.add(`${dir}/${name}`);
};

const org = (id: string, name: string, backupPath = ""): Organisation => ({
  id,
  name,
  createdAt: "2026-01-01T00:00:00Z",
  prefs: backupPath ? ({ backupPath } as Organisation["prefs"]) : null,
});

const invokeMock = () =>
  (fsMock as unknown as { invoke: Mock<(cmd: string, args?: unknown) => Promise<unknown>> }).invoke;
const invokeCalls = async () => invokeMock().mock.calls;

beforeAll(async () => {
  await getDb();
});

beforeEach(async () => {
  memfs.reset();
  clearExecutedStatements();
  setSelectHandler(null);
  useOrgStore.setState({ activeId: "k3f9a2", organisations: [org("k3f9a2", "Studio")] });
  invokeMock().mockClear();
});

describe("backupsToRemove", () => {
  const P = "backup-k3f9a2-";
  const day = (d: Date, time = "10-00-00") =>
    `${P}${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${time}`;
  const daysBack = (n: number) => new Date(Date.UTC(2026, 10, 6) - n * 86400000);
  /** Long after every backup in these tests, so the last-24-hours rule keeps none of them. */
  const LATER = new Date(2027, 0, 1).getTime();
  /** A local time, as the backup stamps are. */
  const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).getTime();
  const hours = (...hs: number[]) => hs.map((h) => `${P}2026-11-06-${String(h).padStart(2, "0")}-00-00`);

  it(`keeps the ${KEEP_RECENT} newest, then the newest of each day`, () => {
    // Seven runs on one day, one the day before
    const names = [...hours(1, 2, 3, 4, 5, 6, 7), `${P}2026-11-05-10-00-00`];
    expect(backupsToRemove(names, P, LATER)).toEqual(hours(1, 2));
  });

  it(`keeps every backup of the last ${KEEP_HOURS} hours`, () => {
    const names = hours(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    expect(backupsToRemove(names, P, at(12))).toEqual([]);
    // A day later the oldest ones fall out (01:00 and 02:00 are more than 24 h before 02:30)
    expect(backupsToRemove(names, P, new Date(2026, 10, 7, 2, 30).getTime())).toEqual(hours(1, 2));
  });

  it("keeps the backup restored from and the safety copy after the next hourly backup", () => {
    // Restored from 09:00; the restore took a safety copy at 10:00; the next auto backup ran at 11:00
    const names = [`${P}2026-11-06-09-00-00`, `${P}2026-11-06-10-00-00-pre-restore`, `${P}2026-11-06-11-00-00`];
    expect(backupsToRemove(names, P, at(11, 1))).toEqual([]);
    // Even once the restored-from backup ages out, the safety copy stays
    const later = [...names, ...hours(12, 13, 14, 15, 16, 17)];
    const removed = backupsToRemove(later, P, LATER);
    expect(removed).toContain(`${P}2026-11-06-09-00-00`);
    expect(removed).not.toContain(`${P}2026-11-06-10-00-00-pre-restore`);
  });

  it(`keeps ${KEEP_DAILY} daily and ${KEEP_MONTHLY} monthly backups`, () => {
    // One backup a day for two years
    const names = Array.from({ length: 730 }, (_, i) => day(daysBack(i)));
    const removed = new Set(backupsToRemove(names, P, LATER));
    const kept = names.filter((n) => !removed.has(n));
    // The 30 newest days are all kept
    for (let i = 0; i < KEEP_DAILY; i++) expect(kept).toContain(day(daysBack(i)));
    // Plus the newest backup of each of the 12 newest months; the first two
    // of those months fall inside the 30 days already kept
    const months = new Set(kept.map((n) => n.slice(P.length, P.length + 7)));
    expect(months.size).toBe(KEEP_MONTHLY);
    expect(kept.length).toBe(KEEP_DAILY + KEEP_MONTHLY - 2);
    expect(kept).toContain(day(new Date(Date.UTC(2025, 11, 31)))); // December 2025's newest
  });

  it("counts days with a backup, so a long break keeps the old copies", () => {
    // Five backups, months apart: none is dropped
    const names = ["2026-11-06", "2026-06-01", "2026-01-15", "2025-08-01", "2025-02-01"].map(
      (d) => `${P}${d}-10-00-00`
    );
    expect(backupsToRemove(names, P, LATER)).toEqual([]);
  });

  it("never drops other organisations', pre-upgrade or unknown folders", () => {
    const names = [
      ...hours(10, 11, 12, 13, 14, 9),
      "backup-zzz999-2026-11-06-08-00-00",
      "backup-2026-11-06-07-00-00",
      "files-k3f9a2",
      `${P}notes`,
    ];
    expect(backupsToRemove(names, P, LATER)).toEqual(hours(9));
  });
});

describe("createBackup", () => {
  /** Six old runs on one day: with the new backup, the oldest (00:00) falls
   *  outside the newest five and rotates. */
  const SAME_DAY = [0, 1, 2, 3, 4, 5].map((h) => `backup-k3f9a2-2020-01-01-0${h}-00-00`);

  it("asks Rust to back up every organisation with every table", async () => {
    useOrgStore.setState({
      organisations: [org("k3f9a2", "Studio"), org("aaa111", "Client A", "/elsewhere"), org("bbb222", "Client B")],
    });
    const path = await createBackup("/backups", { ownFolders: true });

    expect(path).toMatch(/^\/backups\/backup-k3f9a2-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    const call = (await invokeCalls()).find(([cmd]) => cmd === "create_backups");
    expect(call?.[1]).toEqual({
      targets: [
        { orgId: "k3f9a2", dir: "/backups" },
        // Own backup folder when it has one, else the active one's
        { orgId: "aaa111", dir: "/elsewhere" },
        { orgId: "bbb222", dir: "/backups" },
      ],
      tables: TABLES,
      preRestore: false,
    });
  });

  it("names the safety backup before a restore -pre-restore", async () => {
    const path = await createBackup("/backups", { rotate: false, orgs: "active", preRestore: true });
    expect(path).toMatch(/^\/backups\/backup-k3f9a2-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-pre-restore$/);
  });

  it("sends every organisation to the given folder without ownFolders (the second copy)", async () => {
    useOrgStore.setState({ organisations: [org("k3f9a2", "Studio"), org("aaa111", "A", "/elsewhere")] });
    await createBackup("/second");
    const call = (await invokeCalls()).find(([cmd]) => cmd === "create_backups");
    expect((call?.[1] as { targets: unknown }).targets).toEqual([
      { orgId: "k3f9a2", dir: "/second" },
      { orgId: "aaa111", dir: "/second" },
    ]);
  });

  it("writes CSVs and syncs receipts into the shared files folder", async () => {
    setSelectHandler((sql) =>
      sql.includes("SELECT * FROM clients") ? [{ id: "C-001", name: "ACME, Inc" }] : []
    );
    memfs.files.set("/appdata/orgs/k3f9a2/receipts/r1.pdf", new Uint8Array([9]));
    const path = await createBackup("/backups");
    expect(fileText(`${path}/data/clients.csv`)).toBe('id,name\nC-001,"ACME, Inc"');
    expect(memfs.files.has("/backups/files-k3f9a2/receipts/r1.pdf")).toBe(true);
    expect(JSON.parse(fileText(`${path}/manifest.json`)).receipts).toEqual(["r1.pdf"]);
  });

  it("fails when any organisation's backup fails, after rotating the ones that worked", async () => {
    useOrgStore.setState({ organisations: [org("k3f9a2", "Studio"), org("aaa111", "Client A")] });
    memfs.failOrgs.add("aaa111");
    // Six same-day backups of the active organisation: the oldest rotates
    setReadDirEntries("/backups", SAME_DAY);
    memfs.dirs.add("/backups/backup-aaa111-2020-01-01-00-00-00");
    memfs.dirs.add("/backups/backup-aaa111-2020-01-01-01-00-00");

    await expect(createBackup("/backups")).rejects.toThrow("Client A: disk full");
    expect(memfs.removed).toContain("/backups/backup-k3f9a2-2020-01-01-00-00-00");
    // The failed organisation's backups are left alone
    expect(memfs.removed.some((p) => p.includes("aaa111"))).toBe(false);
  });

  it("fails when the active organisation's backup fails", async () => {
    memfs.failOrgs.add("k3f9a2");
    await expect(createBackup("/backups")).rejects.toThrow("Studio: disk full");
  });

  it("needs an active organisation", async () => {
    useOrgStore.setState({ activeId: "" });
    await expect(createBackup("/backups")).rejects.toThrow("No active organisation");
  });

  it("skips rotation when asked (the safety backup before a restore)", async () => {
    setReadDirEntries("/backups", SAME_DAY);
    await createBackup("/backups", { rotate: false, orgs: "active" });
    expect(memfs.removed).toEqual([]);
  });

  it("retries a rotation delete that fails transiently (synced-folder ENOTEMPTY)", async () => {
    vi.useFakeTimers();
    try {
      setReadDirEntries("/backups", SAME_DAY);
      const fs = await import("@tauri-apps/plugin-fs");
      const realRemove = vi.mocked(fs.remove).getMockImplementation()!;
      let failures = 0;
      vi.mocked(fs.remove).mockImplementation(async (p, opts) => {
        if (String(p).endsWith("backup-k3f9a2-2020-01-01-00-00-00") && failures < 2) {
          failures++;
          throw new Error(
            "failed to remove path: /backups/backup-k3f9a2-2020-01-01-00-00-00 with error: Directory not empty (os error 66)"
          );
        }
        return realRemove(p, opts);
      });

      const pending = createBackup("/backups");
      await vi.advanceTimersByTimeAsync(60000);
      await pending;

      expect(failures).toBe(2); // two transient failures were retried through
      expect(memfs.removed).toContain("/backups/backup-k3f9a2-2020-01-01-00-00-00");
      vi.mocked(fs.remove).mockImplementation(realRemove);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with a warning when a rotation delete keeps failing", async () => {
    vi.useFakeTimers();
    try {
      setReadDirEntries("/backups", SAME_DAY);
      const fs = await import("@tauri-apps/plugin-fs");
      const realRemove = vi.mocked(fs.remove).getMockImplementation()!;
      let attempts = 0;
      vi.mocked(fs.remove).mockImplementation(async (p, opts) => {
        if (String(p).endsWith("backup-k3f9a2-2020-01-01-00-00-00")) {
          attempts++;
          throw new Error("Directory not empty (os error 66)");
        }
        return realRemove(p, opts);
      });

      const pending = createBackup("/backups");
      await vi.advanceTimersByTimeAsync(60000);
      // createBackup must still resolve — rotation failure is non-fatal
      const path = await pending;
      expect(path.startsWith("/backups/backup-k3f9a2-")).toBe(true);

      expect(attempts).toBeGreaterThanOrEqual(3); // exhausted retries
      expect(memfs.removed).not.toContain("/backups/backup-k3f9a2-2020-01-01-00-00-00");
      const { logWarn } = await import("../lib/log");
      expect(vi.mocked(logWarn)).toHaveBeenCalledWith(
        expect.stringContaining("backup-k3f9a2-2020-01-01-00-00-00"),
        expect.anything()
      );
      vi.mocked(fs.remove).mockImplementation(realRemove);
    } finally {
      vi.useRealTimers();
    }
  });

  it("listing ignores other organisations' backups and the files folder", async () => {
    setReadDirEntries("/backups", ["backup-k3f9a2-2026-01-01", "backup-zzz999-2026-01-02", "files-k3f9a2"]);
    expect(await listBackups("/backups")).toEqual(["backup-k3f9a2-2026-01-01"]);
  });

  it("listing still shows pre-upgrade backups, which have no organisation id", async () => {
    setReadDirEntries("/backups", [
      "backup-k3f9a2-2026-01-04-09-00-00",
      "backup-2025-12-31-23-59-59", // written before the organisations layout
      "backup-zzz999-2026-01-02-10-00-00", // another organisation: still hidden
      "notes", // unrelated folder
    ]);
    expect(await listBackups("/backups")).toEqual([
      "backup-k3f9a2-2026-01-04-09-00-00",
      "backup-2025-12-31-23-59-59",
    ]);
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
    // (returned as the folder name only), for the active organisation only
    expect(result.safetyBackup.startsWith("backup-k3f9a2-")).toBe(true);
    // Named so retention never drops it
    expect(result.safetyBackup.endsWith("-pre-restore")).toBe(true);
    expect(fileText(`/bk/${result.safetyBackup}/data/clients.csv`)).toContain("Old Client");
    const call = (await invokeCalls()).find(([cmd]) => cmd === "create_backups");
    expect((call?.[1] as { targets: unknown[] }).targets).toEqual([{ orgId: "k3f9a2", dir: "/bk" }]);

    // Deferred FKs, a full wipe, then the insert with the CSV values
    const sqls = executedStatements.map((s) => s.sql);
    expect(sqls.some((s) => s.includes("defer_foreign_keys"))).toBe(true);
    expect(sqls.filter((s) => s.startsWith("DELETE FROM")).length).toBeGreaterThan(10);
    const insert = executedStatements.find((s) => s.sql.startsWith("INSERT INTO clients"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual(["C-001", "ACME, Inc"]);
    expect(sqls.findIndex((s) => s === "DELETE FROM clients")).toBeLessThan(
      sqls.findIndex((s) => s.startsWith("INSERT INTO clients"))
    );
  });

  it("restores the receipts the manifest lists from the shared files folder", async () => {
    seedBackup();
    setSelectHandler(restoreSelectHandler);
    memfs.files.set(
      "/bk/backup-X/manifest.json",
      JSON.stringify({ filesDir: "files-k3f9a2", receipts: ["r1.pdf"], invoices: ["F-001.pdf"] })
    );
    memfs.files.set("/bk/files-k3f9a2/receipts/r1.pdf", "r1");
    memfs.files.set("/bk/files-k3f9a2/receipts/later.pdf", "added after this backup");
    memfs.files.set("/bk/files-k3f9a2/invoices/F-001.pdf", "f1");

    await restoreFromBackup("/bk/backup-X");

    expect(fileText("/appdata/orgs/k3f9a2/receipts/r1.pdf")).toBe("r1");
    expect(fileText("/appdata/orgs/k3f9a2/invoices/F-001.pdf")).toBe("f1");
    expect(memfs.files.has("/appdata/orgs/k3f9a2/receipts/later.pdf")).toBe(false);
  });

  it("restores receipts from an older backup's own folder", async () => {
    seedBackup();
    setSelectHandler(restoreSelectHandler);
    memfs.files.set("/bk/backup-X/receipts/old.pdf", "old");

    await restoreFromBackup("/bk/backup-X");

    expect(fileText("/appdata/orgs/k3f9a2/receipts/old.pdf")).toBe("old");
  });

  it("rejects a manifest that points outside the backup folder", async () => {
    seedBackup();
    setSelectHandler(restoreSelectHandler);
    memfs.files.set("/bk/backup-X/manifest.json", JSON.stringify({ filesDir: "../../etc", receipts: [] }));
    await expect(restoreFromBackup("/bk/backup-X")).rejects.toThrow("invalid files folder");
  });

  it("aborts before touching the database when the backup holds no data", async () => {
    // No CSV files at all
    setSelectHandler(restoreSelectHandler);
    await expect(restoreFromBackup("/bk/backup-empty")).rejects.toThrow(RestoreError);
    expect(executedStatements.some((s) => s.sql.startsWith("DELETE FROM"))).toBe(false);
    // No safety backup was created either — nothing was worth protecting
    expect((await invokeCalls()).some(([cmd]) => cmd === "create_backups")).toBe(false);
  });
});
