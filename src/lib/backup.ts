import { getDb, validateFields, TransactionBatch } from "../db/index";
import {
  writeFile,
  mkdir,
  copyFile,
  exists,
  readDir,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { logWarn, logInfo } from "./log";
import { orgPaths } from "./orgPaths";
import { useOrgStore } from "../stores/org-store";
import { nowMs } from "./clock";

/** Shared lock to prevent concurrent backup operations (auto + manual) */
let _backupRunning = false;
export function isBackupRunning(): boolean {
  return _backupRunning;
}
export function setBackupRunning(v: boolean): void {
  _backupRunning = v;
}

/** True when an fs-plugin error is a scope denial ("forbidden path: ...")
 *  rather than an ordinary IO failure — i.e. the path falls outside the
 *  folders allowed in src-tauri/capabilities/default.json (APPDATA,
 *  Documents, Downloads, Desktop, ~/Library/CloudStorage). Typical cause: a
 *  backup directory stored in a previous session that the narrowed scope no
 *  longer covers. The "forbidden path" match is coupled to tauri-plugin-fs's
 *  error text — re-verify on plugin upgrades; if the text drifts, this
 *  degrades safely to the generic failure message. */
export function isScopeDenied(e: unknown): boolean {
  return String(e).includes("forbidden path");
}

/** Test if a directory is writable by creating and removing a temp file */
export async function validateBackupPath(dir: string): Promise<boolean> {
  // Must not start with "." — tauri-plugin-fs enforces
  // require_literal_leading_dot on Unix, so a dotfile basename never matches
  // the capability scope glob and the write is rejected as a forbidden path.
  const testPath = `${dir}/sm-write-test-${Date.now()}.tmp`;
  try {
    await writeFile(testPath, new Uint8Array([0]));
    await remove(testPath);
    return true;
  } catch {
    return false;
  }
}

/** Every user-data table, ordered parents-before-children (FK-safe insert
 *  order). Single source of truth for both backup export and restore: inserts
 *  iterate this list as-is, deletes iterate it reversed (children first).
 *  Source: src-tauri/migrations
 *  (backupSchema.test.ts fails when a table is missing here).
 *  workload_rows is a legacy staging table drained by ensureSchema on every
 *  startup, but is included for completeness (empty in practice).
 *  When adding a table: insert it here in FK position AND update
 *  EXPECTED_ORDER + the FK edges list in src/__tests__/backupCsv.test.ts. */
export const TABLES = [
  // Root tables (no FK dependencies)
  "business_profile",
  "expense_categories",
  "activities",
  "clients",
  "invoice_templates",
  "workload_templates",
  "income",
  "resources",
  "saved_filters",
  "dashboard_presets",
  "wiki_folders",
  "custom_lists",
  "notifications",
  // Children of clients
  "client_contacts",
  "client_addresses",
  "projects",
  // Children of projects
  "tasks",
  "project_tables",
  "resource_projects",
  // Children of tasks (captures also point at projects and subtasks, task_agents at subtasks)
  "subtasks",
  "captures",
  "task_agents",
  "time_entries",
  "workload_rows",
  // Invoicing (invoices <-> quotes reference each other circularly; restore
  // relies on deferred FK checks, see restoreFromBackup)
  "invoices",
  "invoice_line_items",
  "quotes",
  "quote_line_items",
  "recurring_invoice_templates",
  // Remaining children
  "expenses",
  "resource_tags",
  "project_table_rows",
  "wiki_articles",
  "wiki_article_tags",
  "custom_list_items",
  // Studio upkeep (connections before machines; machines before their children)
  "connections",
  "machines",
  "machine_files",
  "machine_projects",
  "upkeep_items",
  "service_log",
  "consumables",
  "consumable_usage",
  "subscriptions",
  "subscription_renewals",
  "machine_readings",
  "machine_disks",
  // Paperless documents linked to expenses (after connections and expenses)
  "paperless_links",
];

/** Tables kept out of backups on purpose. `meta` records which one-time
 *  seeds already ran in this file: a restore leaves it alone, so restoring a
 *  backup never brings back starter rows the user removed. */
export const NOT_BACKED_UP = ["meta"];

/** Backup folder name prefix for the active organisation. No active
 *  organisation (empty id, e.g. before the org registry loads) falls back to
 *  the legacy unprefixed "backup-" naming — same convention as orgPaths.ts,
 *  and keeps pre-organisation backups discoverable by listing. */
function backupPrefix(): string {
  const id = useOrgStore.getState().activeId;
  return id ? `backup-${id}-` : "backup-";
}

/** Sanitize a file name to prevent path traversal */
function safeName(name: string): string | null {
  const cleaned = name
    .replace(/[/\\]/g, "")
    .replace(/\.\./g, "")
    // eslint-disable-next-line no-control-regex -- intentional: strip null bytes for path-traversal safety
    .replace(/\x00/g, "")                        // null bytes
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "") // zero-width chars
    .normalize("NFC")
    .substring(0, 255);
  return cleaned.length > 0 ? cleaned : null;
}

/** Escape a single CSV field. null/undefined serializes as an unquoted empty
 *  field (SQL NULL sentinel); an empty string serializes as the quoted field ""
 *  so the two round-trip distinctly through parseCsv. */
function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s === "") return '""';
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize rows to CSV with a header line, using the given column order */
export function serializeCsv(
  rows: Record<string, unknown>[],
  columns: string[]
): string {
  const lines = [columns.map((col) => escapeCsv(col)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsv(row[col])).join(","));
  }
  return lines.join("\n");
}

/** One organisation's result from the `create_backups` command (src-tauri/src/backup.rs). */
interface BackupOutcome {
  orgId: string;
  dir: string;
  path: string | null;
  error: string | null;
}

export interface BackupOptions {
  /** "all" (default) backs up every organisation, "active" only the open one. */
  orgs?: "all" | "active";
  /** Send each other organisation to its own backup folder when it has one
   *  (the primary backup). Off: every organisation goes to `backupDir`. */
  ownFolders?: boolean;
  /** false skips rotation (the safety backup taken before a restore). */
  rotate?: boolean;
  /** The safety backup taken before a restore: its folder name ends in
   *  `-pre-restore`, which retention never matches, so it is kept until the
   *  user deletes it. */
  preRestore?: boolean;
}

/** Back up organisations through Rust: a `VACUUM INTO` snapshot, CSVs read
 *  from that snapshot, and the receipts and invoice PDFs synced into a shared
 *  `files-<org id>/` folder (see src-tauri/src/backup.rs). Any error in a
 *  table or a file fails that organisation's backup, which then leaves no
 *  folder behind. Rotation runs only for the backups that succeeded; if any
 *  organisation failed, this throws after rotating the others. Returns the
 *  active organisation's new backup folder. */
export async function createBackup(
  backupDir: string,
  options: BackupOptions = {}
): Promise<string> {
  const { organisations, activeId } = useOrgStore.getState();
  if (!activeId) throw new Error("No active organisation to back up");
  const others = options.orgs === "active" ? [] : organisations.filter((o) => o.id !== activeId);
  const targets = [
    { orgId: activeId, dir: backupDir },
    ...others.map((o) => ({
      orgId: o.id,
      dir: (options.ownFolders && o.prefs?.backupPath) || backupDir,
    })),
  ];
  const outcomes = await invoke<BackupOutcome[]>("create_backups", {
    targets,
    tables: TABLES,
    preRestore: options.preRestore === true,
  });

  if (options.rotate !== false) {
    for (const o of outcomes) {
      if (o.path) await rotateBackups(o.dir, `backup-${o.orgId}-`);
    }
  }

  const failed = outcomes.filter((o) => o.error);
  if (failed.length > 0) {
    const name = (id: string) => organisations.find((o) => o.id === id)?.name ?? id;
    throw new Error(failed.map((o) => `${name(o.orgId)}: ${o.error}`).join("; "));
  }
  const active = outcomes.find((o) => o.orgId === activeId);
  if (!active?.path) throw new Error("Backup of the active organisation is missing");
  return active.path;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delays before each retry of a failed backup-dir delete. */
const REMOVE_RETRY_DELAYS_MS = [3000, 15000];

/** Recursive delete with retries. Rotation runs right after the backup's
 *  file burst — on synced folders (Synology Drive, iCloud, Dropbox) the
 *  sync daemon is mid-flight at that exact moment and `remove` can fail
 *  transiently with "Directory not empty (os error 66)" even though the
 *  same delete succeeds once the daemon settles. Root-caused 2026-08-31:
 *  the identical remove_dir_all succeeded from an idle process on the
 *  same directory that the app had just failed on. */
async function removeBackupDir(path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await remove(path, { recursive: true });
      return;
    } catch (e) {
      if (attempt >= REMOVE_RETRY_DELAYS_MS.length) throw e;
      await sleep(REMOVE_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Backups kept per organisation: the 5 newest, every backup of the last
 *  24 hours, the newest of each of the last 30 days that have a backup, and
 *  the newest of each of the last 12 months. Days without a backup don't
 *  count, so a long break never rotates every copy away. The safety backup
 *  taken before a restore (`-pre-restore`) is never dropped. */
export const KEEP_RECENT = 5;
export const KEEP_HOURS = 24;
export const KEEP_DAILY = 30;
export const KEEP_MONTHLY = 12;

const BACKUP_STAMP = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/;

/** A backup timestamp (local time, as Rust writes it) in ms. */
function stampMs(stamp: string): number {
  const m = BACKUP_STAMP.exec(stamp);
  if (!m) return NaN;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

/** The backup folders under `prefix` that retention drops, oldest first.
 *  Names that don't end in a timestamp (pre-restore copies included) are
 *  never dropped. `now` is in ms. */
export function backupsToRemove(names: string[], prefix: string, now: number = nowMs()): string[] {
  const dated = names
    .filter((n) => n.startsWith(prefix) && BACKUP_STAMP.test(n.slice(prefix.length)))
    .sort()
    .reverse(); // newest first
  const keep = new Set<string>(dated.slice(0, KEEP_RECENT));
  const days = new Set<string>();
  const months = new Set<string>();
  const since = now - KEEP_HOURS * 3600 * 1000;
  for (const name of dated) {
    const stamp = name.slice(prefix.length);
    if (stampMs(stamp) >= since) keep.add(name);
    const day = stamp.slice(0, 10);
    const month = stamp.slice(0, 7);
    if (!days.has(day) && days.size < KEEP_DAILY) {
      days.add(day);
      keep.add(name);
    }
    if (!months.has(month) && months.size < KEEP_MONTHLY) {
      months.add(month);
      keep.add(name);
    }
  }
  return dated.filter((n) => !keep.has(n)).reverse();
}

/** Apply retention to one organisation's backups (`prefix` = `backup-<id>-`)
 *  in `backupDir`. Never touches another organisation's backups, pre-upgrade
 *  backups without an id, or the shared files folders. */
async function rotateBackups(backupDir: string, prefix: string): Promise<void> {
  try {
    const entries = await readDir(backupDir);
    // Name filter only — isFile may be unreliable in Tauri v2 DirEntry.
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    for (const old of backupsToRemove(names, prefix)) {
      const safe = safeName(old);
      if (!safe) continue;
      try {
        await removeBackupDir(`${backupDir}/${safe}`);
      } catch (e) {
        logWarn(`rotateBackups: failed to delete ${safe}:`, String(e));
      }
    }
  } catch (e) {
    logWarn("rotateBackups: could not read backup directory:", String(e));
  }
}

/** Folder names written before organisations existed: `backup-<timestamp>`,
 *  the timestamp starting `YYYY-MM-DD-`. Organisation ids are six base-36
 *  characters, so `backup-<id>-2026-…` can never match this. Listing (not
 *  rotation) accepts these: they hold the user's pre-upgrade backups and
 *  must stay restorable from Settings, while rotation stays strictly
 *  org-scoped so it never deletes a backup it does not own. */
const LEGACY_BACKUP_DIR = /^backup-\d{4}-\d{2}-\d{2}-/;

/** List available backup folders in the backup directory, sorted newest first */
export async function listBackups(backupDir: string): Promise<string[]> {
  if (!backupDir) return [];
  try {
    const entries = await readDir(backupDir);
    const prefix = backupPrefix();
    return entries
      .filter((e) => e.name?.startsWith(prefix) || (e.name != null && LEGACY_BACKUP_DIR.test(e.name)))
      .map((e) => e.name as string)
      .sort()
      .reverse();
  } catch (e) {
    // Let scope denials propagate so the caller can tell the user the
    // directory itself is inaccessible (vs. simply empty/missing).
    if (isScopeDenied(e)) throw e;
    return [];
  }
}

/** Parse a CSV string (RFC 4180) into a header row and data rows.
 *  Handles quoted fields containing commas, escaped quotes ("") and newlines;
 *  accepts both \n and \r\n record separators. An unquoted empty field parses
 *  as null (SQL NULL sentinel); a quoted empty field "" parses as "".
 *  Malformed input (unterminated/stray quotes) is parsed leniently, never
 *  rejected — intentional since serializeCsv is the only producer. */
export function parseCsv(csv: string): {
  columns: string[];
  rows: (string | null)[][];
} {
  const records: (string | null)[][] = [];
  let record: (string | null)[] = [];
  let field = "";
  let fieldQuoted = false; // whether the current field used quotes
  let inQuotes = false;

  const endField = () => {
    record.push(field === "" && !fieldQuoted ? null : field);
    field = "";
    fieldQuoted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      fieldQuoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r" && csv[i + 1] === "\n") {
      endRecord();
      i++;
    } else {
      field += ch;
    }
  }
  // Flush the final record unless the input ended with a newline (or was empty)
  if (field !== "" || fieldQuoted || record.length > 0) {
    endRecord();
  }

  if (records.length === 0) return { columns: [], rows: [] };
  return {
    columns: records[0].map((c) => c ?? ""),
    rows: records.slice(1),
  };
}

/** Column metadata row as returned by pragma_table_info */
export interface TableColumnInfo {
  name: string;
  notnull: number;
  dflt_value: string | null;
  type: string;
}

/** Parse a SQLite dflt_value when it is a simple literal: a single-quoted
 *  string ('', 'draft') or a plain number (0, 1.5). Returns undefined for a
 *  missing default or a non-literal expression like (datetime('now')). */
function parseDefaultLiteral(dflt: string | null): string | number | undefined {
  if (dflt === null) return undefined;
  const trimmed = dflt.trim();
  if (/^'(?:[^']|'')*'$/.test(trimmed)) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return undefined;
}

/** Fallback default by type affinity: 0 for numeric columns, '' otherwise.
 *  Covers TEXT/INTEGER/REAL as used in this schema. */
function affinityDefault(type: string): string | number {
  const t = type.toUpperCase();
  const numeric =
    t.includes("INT") ||
    t.includes("REAL") ||
    t.includes("FLOA") ||
    t.includes("DOUB") ||
    t.includes("NUM") ||
    t.includes("DEC");
  return numeric ? 0 : "";
}

/** Map a parsed CSV row to insert values, substituting the column's declared
 *  default (or a type-affinity fallback) for any null hitting a NOT NULL
 *  column. Empty strings pass through untouched; nullable columns keep null.
 *  Needed because old backups serialize every empty value as null.
 *  Accepts either raw pragma_table_info rows or a prebuilt name-to-info Map;
 *  callers iterating many rows should prebuild the Map once per table. */
export function applyNotNullDefaults(
  row: (string | null)[],
  columns: string[],
  tableInfo: TableColumnInfo[] | Map<string, TableColumnInfo>
): { values: (string | number | null)[]; substitutions: number } {
  const infoByName =
    tableInfo instanceof Map
      ? tableInfo
      : new Map(tableInfo.map((c) => [c.name, c]));
  let substitutions = 0;
  const values = columns.map((col, i): string | number | null => {
    const value = row[i] ?? null;
    if (value !== null) return value;
    const info = infoByName.get(col);
    if (!info || info.notnull !== 1) return null;
    substitutions++;
    return parseDefaultLiteral(info.dflt_value) ?? affinityDefault(info.type);
  });
  return { values, substitutions };
}

/** Error thrown by restoreFromBackup for known user-facing failure modes.
 *  The caller (SettingsPage) maps `code` to a translated message. */
export class RestoreError extends Error {
  constructor(
    public readonly code: "backup_empty" | "safety_backup_failed",
    public readonly detail = ""
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "RestoreError";
  }
}

/** Throw if no parsed backup CSV contains any data row. Header-only or empty
 *  CSVs do not count: an interrupted backup can leave an empty-but-valid-
 *  looking folder, and "restoring" it would just wipe every table. */
export function assertRestorableData(parsed: { rows: unknown[][] }[]): void {
  if (!parsed.some((p) => p.rows.length > 0)) {
    throw new RestoreError("backup_empty");
  }
}

/** `manifest.json` written by src-tauri/src/backup.rs. */
interface BackupManifest {
  filesDir: string;
  receipts: string[];
  invoices: string[];
}

const FILES_DIR = /^files-[a-z0-9]+$/;

/** The backup's manifest, or null for a backup written before manifests. */
async function readManifest(backupPath: string): Promise<BackupManifest | null> {
  const path = `${backupPath}/manifest.json`;
  if (!(await exists(path))) return null;
  const m = JSON.parse(await readTextFile(path)) as Partial<BackupManifest>;
  if (typeof m.filesDir !== "string" || !FILES_DIR.test(m.filesDir)) {
    throw new Error("Backup manifest names an invalid files folder");
  }
  return {
    filesDir: m.filesDir,
    receipts: Array.isArray(m.receipts) ? m.receipts : [],
    invoices: Array.isArray(m.invoices) ? m.invoices : [],
  };
}

/** Copy the named files from `from` into `to`. A missing file is logged and
 *  skipped: the database restore already succeeded. */
async function copyListed(from: string, to: string, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await mkdir(to, { recursive: true });
  for (const raw of names) {
    const name = safeName(raw);
    if (!name) continue;
    try {
      await copyFile(`${from}/${name}`, `${to}/${name}`);
    } catch (e) {
      logWarn(`Restore: could not copy ${name}:`, String(e));
    }
  }
}

/** Copy every file of an older backup's own `receipts/` or `invoices/` folder. */
async function copyFolder(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return;
  try {
    const entries = await readDir(from);
    const names = entries.filter((e) => e.isFile && e.name).map((e) => e.name as string);
    await copyListed(from, to, names);
  } catch (e) {
    logWarn(`Restore: could not read ${from}:`, String(e));
  }
}

/** Restore the database and files from a backup folder.
 *  A safety backup of the current data is created first (restore aborts if
 *  that fails). The database restore (delete + insert, all tables) then runs
 *  as ONE Rust-side transaction, so it is all-or-nothing: on any failure the
 *  transaction is rolled back, current data is left untouched, and the error
 *  propagates to the caller. Returns integrity warnings (empty = all good),
 *  the number of null values substituted with column defaults for NOT NULL
 *  columns, and the safety backup's folder name. */
export async function restoreFromBackup(
  backupPath: string
): Promise<{ warnings: string[]; valuesDefaulted: number; safetyBackup: string }> {
  const db = await getDb();
  const dataDir = `${backupPath}/data`;
  let valuesDefaulted = 0;

  // Read and parse every table CSV up-front — file reads and SELECTs stay
  // outside the transaction batch.
  const parsed: {
    table: string;
    columns: string[];
    rows: (string | null)[][];
  }[] = [];
  for (const table of TABLES) {
    const csvPath = `${dataDir}/${table}.csv`;
    if (!(await exists(csvPath))) continue;
    const csv = await readTextFile(csvPath);
    parsed.push({ table, ...parseCsv(csv) });
  }

  // Abort before touching anything if the backup holds no data at all, or
  // its manifest is unreadable.
  assertRestorableData(parsed);
  const manifest = await readManifest(backupPath);

  // Safety net: back up the active organisation into the normal backup
  // location before wiping anything, so even restoring the wrong backup can
  // be undone. Its name ends in `-pre-restore`, which retention never drops,
  // and it doesn't rotate, so it can't remove the backup being restored.
  // Abort if the safety backup fails.
  const slash = backupPath.lastIndexOf("/");
  const backupDir = slash > 0 ? backupPath.slice(0, slash) : backupPath;
  const safetyBackupPath = await createBackup(backupDir, { orgs: "active", rotate: false, preRestore: true }).catch((e) => {
    throw new RestoreError("safety_backup_failed", String(e));
  });

  // Fetch per-table NOT NULL metadata so nulls from old backups (which
  // serialize every empty value unquoted) can be substituted with column
  // defaults up-front.
  const toRestore: {
    table: string;
    columns: string[];
    rows: (string | null)[][];
    infoByName: Map<string, TableColumnInfo>;
  }[] = [];
  for (const { table, columns, rows } of parsed) {
    if (rows.length === 0) continue;
    validateFields(columns);
    const tableInfo = await db.select<TableColumnInfo[]>(
      `SELECT name, "notnull", dflt_value, type FROM pragma_table_info('${table}')`
    );
    toRestore.push({
      table,
      columns,
      rows,
      infoByName: new Map(tableInfo.map((c) => [c.name, c])),
    });
  }

  // Restore is full-wipe: tables with rows now but no data in this backup
  // (e.g. old 13-table backups) get cleared below without being repopulated.
  // Count them BEFORE the wipe and surface it to the user as a warning.
  const warnings: string[] = [];
  const restoredTables = new Set(toRestore.map((r) => r.table));
  for (const table of TABLES) {
    if (restoredTables.has(table)) continue;
    try {
      const result = await db.select<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM ${table}`
      );
      const cnt = result[0]?.cnt ?? 0;
      if (cnt > 0) {
        warnings.push(
          `${table}: ${cnt} current rows are not in this backup and were removed`
        );
      }
    } catch {
      // table may not exist
    }
  }

  // Delete (children first) then insert (parents first) in a single Rust-side
  // transaction on ONE connection. defer_foreign_keys moves FK enforcement to
  // COMMIT — valid inside a transaction, immune to the pooled-connection
  // issue documented on TransactionBatch in src/db/index.ts, and it makes the circular
  // invoices <-> quotes references restorable in a fixed order. (The Rust
  // batch command sets foreign_keys=ON, so this pragma is active.)
  const batch = new TransactionBatch();
  batch.add("PRAGMA defer_foreign_keys = ON");
  // Full-wipe trade-off: EVERY table is cleared, including tables this backup
  // has no CSV for (counted and warned about above).
  for (const table of [...TABLES].reverse()) {
    batch.add(`DELETE FROM ${table}`);
  }
  for (const { table, columns, rows, infoByName } of toRestore) {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
    for (const row of rows) {
      const { values, substitutions } = applyNotNullDefaults(row, columns, infoByName);
      valuesDefaulted += substitutions;
      batch.add(sql, values);
    }
  }
  await batch.commit();

  // Integrity check: compare restored row counts against the parsed CSVs.
  // Belt-and-braces only — after the atomic commit above a shortfall should
  // be impossible.
  for (const { table, rows } of toRestore) {
    try {
      const result = await db.select<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM ${table}`
      );
      const actualCount = result[0]?.cnt ?? 0;
      if (actualCount < rows.length) {
        warnings.push(`${table}: expected ${rows.length} rows, got ${actualCount}`);
      }
    } catch {
      // table may not exist
    }
  }
  if (warnings.length > 0) {
    logWarn("Restore integrity warnings:", warnings.join("; "));
  } else {
    logInfo("Restore integrity check passed for all tables");
  }

  // Restore receipts and invoice PDFs
  const { invoicesDir, receiptsDir } = await orgPaths();
  if (manifest) {
    // Current layout: the files sit in the shared files folder next to the
    // backups; the manifest lists the ones this backup had.
    const store = `${backupDir}/${manifest.filesDir}`;
    await copyListed(`${store}/receipts`, receiptsDir, manifest.receipts);
    await copyListed(`${store}/invoices`, invoicesDir, manifest.invoices);
  } else {
    // Older backups hold their own copies inside the backup folder.
    await copyFolder(`${backupPath}/receipts`, receiptsDir);
    await copyFolder(`${backupPath}/invoices`, invoicesDir);
  }

  if (valuesDefaulted > 0) {
    logInfo(`Restore: substituted ${valuesDefaulted} null value(s) with NOT NULL column defaults`);
  }

  return {
    warnings,
    valuesDefaulted,
    safetyBackup: safetyBackupPath.split("/").pop() ?? safetyBackupPath,
  };
}
