import { getDb } from "../db/index";
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

const TABLES = [
  "business_profile",
  "clients",
  "client_contacts",
  "projects",
  "tasks",
  "subtasks",
  "invoices",
  "invoice_line_items",
  "quotes",
  "quote_line_items",
  "expense_categories",
  "expenses",
  "notifications",
];

/** Sanitize a file name to prevent path traversal */
function safeName(name: string): string | null {
  const cleaned = name.replace(/[/\\]/g, "").replace(/\.\./g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function exportTableCsv(tableName: string): Promise<string> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM ${tableName}`
  );
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n");
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
  if (maxBackups <= 0) return;
  try {
    const entries = await readDir(backupDir);
    const backups = entries
      .filter((e) => !e.isFile && e.name?.startsWith("backup-"))
      .map((e) => e.name as string)
      .sort();

    while (backups.length > maxBackups) {
      const oldest = backups.shift();
      if (!oldest) break;
      const safe = safeName(oldest);
      if (safe) await remove(`${backupDir}/${safe}`, { recursive: true });
    }
  } catch {
    // rotation failure is non-critical
  }
}

/** List available backup folders in the backup directory, sorted newest first */
export async function listBackups(backupDir: string): Promise<string[]> {
  if (!backupDir) return [];
  try {
    const entries = await readDir(backupDir);
    return entries
      .filter((e) => !e.isFile && e.name?.startsWith("backup-"))
      .map((e) => e.name as string)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Parse a CSV string into an array of objects using the header row as keys */
function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split("\n");
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/** Parse a single CSV line handling quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// Tables in the order they should be deleted (children first) and inserted (parents first)
const DELETE_ORDER = [
  "notifications",
  "invoice_line_items",
  "quote_line_items",
  "expenses",
  "invoices",
  "quotes",
  "tasks",
  "subtasks",
  "projects",
  "client_contacts",
  "clients",
  "business_profile",
  "expense_categories",
];

const INSERT_ORDER = [
  "expense_categories",
  "business_profile",
  "clients",
  "client_contacts",
  "projects",
  "tasks",
  "subtasks",
  "invoices",
  "invoice_line_items",
  "quotes",
  "quote_line_items",
  "expenses",
  "notifications",
];

/** Restore the database and files from a backup folder */
export async function restoreFromBackup(backupPath: string): Promise<void> {
  const db = await getDb();
  const dataDir = `${backupPath}/data`;

  // Disable FK checks during restore
  await db.execute("PRAGMA foreign_keys = OFF");
  try {
    // Clear all tables in child-first order
    for (const table of DELETE_ORDER) {
      try {
        await db.execute(`DELETE FROM ${table}`);
      } catch {
        // table may not exist
      }
    }

    // Re-insert data from CSVs in parent-first order
    for (const table of INSERT_ORDER) {
      const csvPath = `${dataDir}/${table}.csv`;
      if (!(await exists(csvPath))) continue;

      const csv = await readTextFile(csvPath);
      const rows = parseCsv(csv);
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map((col) => {
          const v = row[col];
          if (v === "") return null;
          return v;
        });
        try {
          await db.execute(sql, values);
        } catch (e) {
          console.warn(`Restore: failed to insert into ${table}:`, e);
        }
      }
    }
  } finally {
    await db.execute("PRAGMA foreign_keys = ON");
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
}
