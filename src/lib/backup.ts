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
import { appDataDir } from "@tauri-apps/api/path";
import { logWarn, logInfo } from "./log";

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
  const testPath = `${dir}/.sm-write-test-${Date.now()}`;
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
 *  Sources: src-tauri/migrations/001-005 + ensureSchema in src/db/index.ts.
 *  workload_rows is a legacy staging table drained by ensureSchema on every
 *  startup, but is included for completeness (empty in practice).
 *  When adding a table: insert it here in FK position AND update
 *  EXPECTED_ORDER + the FK edges list in src/__tests__/backupCsv.test.ts. */
export const TABLES = [
  // Root tables (no FK dependencies)
  "business_profile",
  "expense_categories",
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
  // Children of tasks
  "subtasks",
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
];

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

async function exportTableCsv(tableName: string): Promise<string> {
  if (!TABLES.includes(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM ${tableName}`
  );
  if (rows.length === 0) return "";
  return serializeCsv(rows, Object.keys(rows[0]));
}

export async function createBackup(
  backupDir: string,
  maxBackups: number
): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const backupPath = `${backupDir}/backup-${ts}`;

  // Create directory structure
  await mkdir(`${backupPath}/data`, { recursive: true });
  await mkdir(`${backupPath}/receipts`, { recursive: true });
  await mkdir(`${backupPath}/invoices`, { recursive: true });

  // Export each table as CSV
  for (const table of TABLES) {
    try {
      const csv = await exportTableCsv(table);
      if (csv) {
        const bytes = new TextEncoder().encode(csv);
        await writeFile(`${backupPath}/data/${table}.csv`, bytes);
      }
    } catch {
      // Table may not exist yet (subtasks, notifications)
    }
  }

  // Copy receipt files
  const dataDir = await appDataDir();
  const receiptsDir = `${dataDir}/receipts`;
  if (await exists(receiptsDir)) {
    try {
      const entries = await readDir(receiptsDir);
      for (const entry of entries) {
        const name = entry.name ? safeName(entry.name) : null;
        if (entry.isFile && name) {
          await copyFile(
            `${receiptsDir}/${name}`,
            `${backupPath}/receipts/${name}`
          );
        }
      }
    } catch {
      // receipts dir may be empty
    }
  }

  // Copy stored invoice PDFs
  const invoicesDir = `${dataDir}/invoices`;
  if (await exists(invoicesDir)) {
    try {
      const entries = await readDir(invoicesDir);
      for (const entry of entries) {
        const name = entry.name ? safeName(entry.name) : null;
        if (entry.isFile && name) {
          await copyFile(
            `${invoicesDir}/${name}`,
            `${backupPath}/invoices/${name}`
          );
        }
      }
    } catch {
      // invoices dir may be empty
    }
  }

  // Rotate old backups
  await rotateBackups(backupDir, maxBackups);

  return backupPath;
}

async function rotateBackups(
  backupDir: string,
  maxBackups: number
): Promise<void> {
  const limit = Number(maxBackups);
  if (!Number.isFinite(limit) || limit <= 0) return;
  try {
    const entries = await readDir(backupDir);
    // Use name prefix as primary filter — isFile may be unreliable in Tauri v2 DirEntry
    const backups = entries
      .filter((e) => e.name?.startsWith("backup-"))
      .map((e) => e.name as string)
      .sort();

    while (backups.length > limit) {
      const oldest = backups.shift();
      if (!oldest) break;
      const safe = safeName(oldest);
      if (!safe) continue;
      try {
        await remove(`${backupDir}/${safe}`, { recursive: true });
      } catch (e) {
        logWarn(`rotateBackups: failed to delete ${safe}:`, String(e));
      }
    }
  } catch (e) {
    logWarn("rotateBackups: could not read backup directory:", String(e));
  }
}

/** List available backup folders in the backup directory, sorted newest first */
export async function listBackups(backupDir: string): Promise<string[]> {
  if (!backupDir) return [];
  try {
    const entries = await readDir(backupDir);
    return entries
      .filter((e) => e.name?.startsWith("backup-"))
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

  // Abort before touching anything if the backup holds no data at all
  assertRestorableData(parsed);

  // Safety net: snapshot the current data into the normal backup location
  // (normal timestamped naming) before wiping anything, so even restoring
  // the wrong backup can be undone. maxBackups=0 disables rotation, so this
  // snapshot can never rotate away the very backup being restored; the next
  // regular backup rotates as usual. Abort if the snapshot fails.
  const slash = backupPath.lastIndexOf("/");
  const backupDir = slash > 0 ? backupPath.slice(0, slash) : backupPath;
  const safetyBackupPath = await createBackup(backupDir, 0).catch((e) => {
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

  // Restore receipt files
  const appDir = await appDataDir();
  const receiptsBackup = `${backupPath}/receipts`;
  if (await exists(receiptsBackup)) {
    const receiptsDir = `${appDir}/receipts`;
    await mkdir(receiptsDir, { recursive: true });
    try {
      const entries = await readDir(receiptsBackup);
      for (const entry of entries) {
        const name = entry.name ? safeName(entry.name) : null;
        if (entry.isFile && name) {
          await copyFile(`${receiptsBackup}/${name}`, `${receiptsDir}/${name}`);
        }
      }
    } catch {
      // non-critical
    }
  }

  // Restore invoice PDFs
  const invoicesBackup = `${backupPath}/invoices`;
  if (await exists(invoicesBackup)) {
    const invoicesDir = `${appDir}/invoices`;
    await mkdir(invoicesDir, { recursive: true });
    try {
      const entries = await readDir(invoicesBackup);
      for (const entry of entries) {
        const name = entry.name ? safeName(entry.name) : null;
        if (entry.isFile && name) {
          await copyFile(`${invoicesBackup}/${name}`, `${invoicesDir}/${name}`);
        }
      }
    } catch {
      // non-critical
    }
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
