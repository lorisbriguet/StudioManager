// Stand-in for the Rust `create_backups` command (src-tauri/src/backup.rs) over
// the in-memory filesystems the backup tests use. It writes what the command
// writes: data/<table>.csv (serializeCsv format, no file for an empty table),
// receipts and invoices synced into files-<org id>/, and manifest.json. The
// Rust tests cover the real snapshot, CSV and file sync.
import { serializeCsv } from "../../lib/backup";

interface MemFs {
  files: Map<string, Uint8Array | string>;
  dirs: Set<string>;
}

interface Target {
  orgId: string;
  dir: string;
}

export interface FakeBackupOptions {
  /** Rows of a table, as `SELECT *` returns them. */
  rows: (table: string) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];
  /** Organisations whose backup fails. */
  failOrgs?: Set<string>;
  appData?: string;
}

let seconds = 0;
/** Timestamps one second apart, so two backups in one test never collide. */
function nextStamp(): string {
  seconds++;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `2026-11-06-10-${pad(Math.floor(seconds / 60) % 60)}-${pad(seconds % 60)}`;
}

function filesUnder(fs: MemFs, dir: string): string[] {
  return [...fs.files.keys()]
    .filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes("/"))
    .map((k) => k.slice(dir.length + 1))
    .sort();
}

export function fakeCreateBackups(fs: MemFs, opts: FakeBackupOptions) {
  const appData = opts.appData ?? "/appdata";
  return async (args: { targets: Target[]; tables: string[] }) => {
    const stamp = nextStamp();
    const outcomes = [];
    for (const { orgId, dir } of args.targets) {
      if (opts.failOrgs?.has(orgId)) {
        outcomes.push({ orgId, dir, path: null, error: "disk full" });
        continue;
      }
      const path = `${dir}/backup-${orgId}-${stamp}`;
      fs.dirs.add(`${path}/data`);
      fs.files.set(`${path}/studiomanager.db`, new Uint8Array([1]));
      for (const table of args.tables) {
        const rows = await opts.rows(table);
        if (rows.length > 0) {
          fs.files.set(`${path}/data/${table}.csv`, serializeCsv(rows, Object.keys(rows[0])));
        }
      }
      const manifest: Record<string, unknown> = { version: 1, orgId, orgName: orgId, filesDir: `files-${orgId}`, missingTables: [] };
      for (const sub of ["receipts", "invoices"]) {
        const src = `${appData}/orgs/${orgId}/${sub}`;
        const names = filesUnder(fs, src);
        for (const n of names) fs.files.set(`${dir}/files-${orgId}/${sub}/${n}`, fs.files.get(`${src}/${n}`)!);
        manifest[sub] = names;
      }
      fs.files.set(`${path}/manifest.json`, JSON.stringify(manifest));
      outcomes.push({ orgId, dir, path, error: null });
    }
    return outcomes;
  };
}
