/**
 * Data migration script: imports Notion export + Spreadsheet data into StudioManager SQLite DB.
 * Run with: node scripts/migrate-data.mjs
 */
import { readFileSync, existsSync } from "fs";
import { parse } from "csv-parse/sync";
import Database from "better-sqlite3";
import XLSX from "xlsx";

const DB_PATH = `${process.env.HOME}/Library/Application Support/ch.lorisbriguet.studiomanager/studiomanager.db`;
const NOTION_DIR = `${process.env.HOME}/Downloads/Private & Shared 2/C R M`;
const COMPTA_DIR = `${process.env.HOME}/Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta`;
const SPREADSHEET = `${COMPTA_DIR}/2025/LORIS BRIGUET - 2025 - Comptabilité & facturation.xlsx`;
const SPREADSHEET_2024 = `${COMPTA_DIR}/2024/LORIS BRIGUET - 2024 - Comptabilité & facturation.xlsx`;
const SPREADSHEET_2026 = `${process.env.HOME}/Downloads/indépendant /LORIS BRIGUET - 2026 - Comptabilité & facturation.xlsx`;

// ─── Helpers ───
function readCSV(path) {
  const content = readFileSync(path, "utf-8").replace(/^\uFEFF/, ""); // strip BOM
  return parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

function extractName(mdLink) {
  // "App Cadavre Exquis (C%20R%20M/Projects/App...md)" -> "App Cadavre Exquis"
  if (!mdLink) return "";
  const match = mdLink.match(/^(.+?)\s*\(/);
  return match ? match[1].trim() : mdLink.trim();
}

function parsePriority(raw) {
  if (!raw) return "medium";
  const s = raw.replace(/\s/g, "").toLowerCase();
  if (s.includes("high")) return "high";
  if (s.includes("low")) return "low";
  return "medium";
}

function parseStatus(raw) {
  if (!raw) return "todo";
  const s = raw.toLowerCase().replace(/\s+/g, "_");
  if (s.includes("done") || s.includes("completed")) return "done";
  if (s.includes("in_progress") || s.includes("progress")) return "in_progress";
  return "todo";
}

function parseProjectStatus(raw) {
  if (!raw) return "active";
  const s = raw.toLowerCase().replace(/\s+/g, "_");
  if (s.includes("done") || s.includes("completed")) return "completed";
  if (s.includes("hold")) return "on_hold";
  if (s.includes("cancel")) return "cancelled";
  return "active";
}

function parseDate(raw) {
  if (!raw) return null;
  // "March 14, 2023 5:40 PM" -> "2023-03-14"
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

function parseAmount(raw) {
  if (!raw) return 0;
  const s = String(raw).replace(/[^0-9.,\-]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

// ─── Main ───
console.log("Starting data migration...\n");

if (!existsSync(DB_PATH)) {
  console.error(`Database not found at ${DB_PATH}`);
  console.error("Run the app once first to create the database.");
  process.exit(1);
}

const db = Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── 1. Import Spreadsheet Clients (with addresses, language, discount) ───
console.log("=== Importing Spreadsheet Data ===");

const wb = XLSX.readFile(SPREADSHEET);

// Clients sheet
const clientsSheet = wb.Sheets[wb.SheetNames[1]]; // "Clients" is 2nd sheet
const clientsData = XLSX.utils.sheet_to_json(clientsSheet, { header: 1 });

const insertClient = db.prepare(`
  INSERT OR IGNORE INTO clients (id, name, address_line1, address_line2, email, phone, language, has_discount, discount_rate, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const spreadsheetClients = new Map();
let clientCount = 0;

// Row 0 = "Clients" label, Row 1 = headers, data starts at row 2
for (let i = 2; i < clientsData.length; i++) {
  const row = clientsData[i];
  if (!row || !row[0]) continue;
  const id = String(row[0]).trim();     // A: ID (C-001, etc)
  const name = String(row[1] || "").trim();    // B: Name
  const addr1 = String(row[2] || "").trim();   // C: Address L1
  const addr2 = String(row[3] || "").trim();   // D: Address L2
  const lang = String(row[4] || "FR").trim();  // E: Language
  const hasDiscount = row[5] === "Y" || row[5] === "y" ? 1 : 0; // F: Discount
  const discountRate = parseFloat(row[6]) || 0;                   // G: Rate

  if (!name) continue;
  insertClient.run(id, name, addr1, addr2, "", "", lang, hasDiscount, discountRate, "");
  spreadsheetClients.set(name.toLowerCase(), id);
  clientCount++;
}
console.log(`  Clients from spreadsheet: ${clientCount}`);

// Excel serial number to ISO date
function excelDate(serial) {
  if (!serial || typeof serial !== "number") return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

// Also build a name->id map from ALL clients (spreadsheet + notion)
const allClientsByName = new Map();
const allClients = db.prepare("SELECT id, name FROM clients").all();
for (const c of allClients) {
  allClientsByName.set(c.name.toLowerCase(), c.id);
}

const insertInvoice = db.prepare(`
  INSERT OR IGNORE INTO invoices (reference, client_id, status, language, activity, invoice_date, due_date, payment_terms_days, subtotal, discount_applied, discount_rate, total, paid_date, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, 30, ?, 0, 0, ?, ?, ?)
`);

const insertExpense = db.prepare(`
  INSERT OR IGNORE INTO expenses (reference, supplier, category_code, invoice_date, due_date, amount, paid_date, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function importInvoicesFromSheet(workbook, label) {
  const invoiceSheet = workbook.Sheets["SUIVI DES FACTURES"];
  if (!invoiceSheet) { console.log(`  No invoice sheet in ${label}`); return; }
  const invoiceData = XLSX.utils.sheet_to_json(invoiceSheet, { header: 1 });

  let count = 0;
  for (let i = 4; i < invoiceData.length; i++) {
    const row = invoiceData[i];
    if (!row || !row[4]) continue;
    const ref = String(row[4]).trim();
    if (!ref.match(/^\d{4}-\d{3}$/)) continue;

    const clientName = String(row[0] || "").trim();
    const amount = parseAmount(row[5]);
    const invoiceDate = excelDate(row[3]);
    const dueDate = excelDate(row[6]);
    const paidDate = excelDate(row[7]);

    let clientId = "";
    const lowerName = clientName.toLowerCase().trim();
    for (const [name, id] of allClientsByName) {
      if (lowerName.includes(name) || name.includes(lowerName)) {
        clientId = id;
        break;
      }
    }

    if (!clientId) {
      const maxNum = db.prepare("SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) as n FROM clients").get()?.n ?? 0;
      clientId = `C-${String(maxNum + 1).padStart(3, "0")}`;
      insertClient.run(clientId, clientName, "", "", "", "", "FR", 0, 0, "Auto-created from invoice");
      allClientsByName.set(lowerName, clientId);
    }

    const status = paidDate ? "paid" : "draft";
    try {
      insertInvoice.run(ref, clientId, status, "FR", "Graphisme", invoiceDate, dueDate, amount, amount, paidDate, "");
      count++;
    } catch (e) { /* Ignore duplicates */ }
  }
  console.log(`  Invoices from ${label}: ${count}`);
}

function importExpensesFromSheet(workbook, label) {
  const expSheet = workbook.Sheets["SUIVI DES FRAIS"];
  if (!expSheet) { console.log(`  No expense sheet in ${label}`); return; }
  const expData = XLSX.utils.sheet_to_json(expSheet, { header: 1 });

  let count = 0;
  for (let i = 4; i < expData.length; i++) {
    const row = expData[i];
    if (!row || !row[3]) continue;
    const ref = String(row[3]).trim();
    if (!ref.match(/^F-\d{2}-\d{3}$/)) continue;

    const supplier = String(row[0] || "").trim();
    const category = String(row[1] || "FA").trim().toUpperCase();
    const amount = parseAmount(row[4]);
    const invoiceDate = excelDate(row[2]);
    const dueDate = excelDate(row[5]);
    const paidDate = excelDate(row[6]);

    const validCategories = ["AM", "FA", "FD", "FR", "LO", "CS"];
    const cat = validCategories.includes(category) ? category : "FA";

    try {
      insertExpense.run(ref, supplier, cat, invoiceDate, dueDate, amount, paidDate, "");
      count++;
    } catch (e) { /* Ignore duplicates */ }
  }
  console.log(`  Expenses from ${label}: ${count}`);
}

// Import from 2025 spreadsheet
importInvoicesFromSheet(wb, "2025");
importExpensesFromSheet(wb, "2025");

// Import from 2024 spreadsheet
if (existsSync(SPREADSHEET_2024)) {
  console.log("\n=== Importing 2024 Spreadsheet ===");
  const wb2024 = XLSX.readFile(SPREADSHEET_2024);
  importInvoicesFromSheet(wb2024, "2024");
  importExpensesFromSheet(wb2024, "2024");
} else {
  console.log("  2024 spreadsheet not found, skipping");
}

// Import from 2026 spreadsheet
if (existsSync(SPREADSHEET_2026)) {
  console.log("\n=== Importing 2026 Spreadsheet ===");
  const wb2026 = XLSX.readFile(SPREADSHEET_2026);
  importInvoicesFromSheet(wb2026, "2026");
  importExpensesFromSheet(wb2026, "2026");
} else {
  console.log("  2026 spreadsheet not found, skipping");
}

// ─── 2. Import Notion Clients ───
console.log("\n=== Importing Notion Data ===");

const pipelineCSV = readCSV(`${NOTION_DIR}/Pipeline c8f1af295f82479d91a0428104e1d47e_all.csv`);

// Track Notion client name -> our client ID
const notionClientMap = new Map();
let nextClientNum = db.prepare("SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) as n FROM clients").get()?.n ?? 0;

for (const row of pipelineCSV) {
  const name = row.Name?.trim();
  if (!name) continue;

  const notionId = row.ID?.trim() || "";
  const email = row["Email 1"]?.trim() || "";
  const status = row.Status?.trim() || "Inactive";

  // Check if already exists (from spreadsheet)
  const existing = db.prepare("SELECT id FROM clients WHERE LOWER(name) = LOWER(?)").get(name);
  if (existing) {
    notionClientMap.set(name, existing.id);
    // Update email if we have one
    if (email) {
      db.prepare("UPDATE clients SET email = ? WHERE id = ? AND (email IS NULL OR email = '')").run(email, existing.id);
    }
    continue;
  }

  // Create new client
  nextClientNum++;
  const id = `C-${String(nextClientNum).padStart(3, "0")}`;
  const notes = status === "Inactive" ? "Imported from Notion (inactive)" : "";

  try {
    insertClient.run(id, name, "", "", email, "", "FR", 0, 0, notes);
    notionClientMap.set(name, id);
  } catch (e) {
    // ignore
  }
}
console.log(`  Notion clients imported: ${notionClientMap.size}`);

// ─── 3. Import Notion Projects ───
const projectsCSV = readCSV(`${NOTION_DIR}/Projects a2b81492b9d648b3b98a2da3d62592cb_all.csv`);

const insertProject = db.prepare(`
  INSERT INTO projects (client_id, name, description, status, start_date, deadline, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const projectNameToId = new Map();
let projectCount = 0;

for (const row of projectsCSV) {
  const name = row.Name?.trim();
  if (!name) continue;

  // Find client
  const clientRef = row.Client || "";
  const clientName = extractName(clientRef);
  const clientId = notionClientMap.get(clientName) || "";

  if (!clientId) continue; // Can't import without client

  const status = parseProjectStatus(row.STATUS);
  const created = parseDate(row.Created);
  const deadline = parseDate(row["Due Date"]);
  const timeSpent = row.timeSpent ? `Time spent: ${row.timeSpent}h` : "";

  // Check if already exists
  const exists = db.prepare("SELECT id FROM projects WHERE name = ? AND client_id = ?").get(name, clientId);
  if (exists) {
    projectNameToId.set(name, exists.id);
    continue;
  }

  try {
    const info = insertProject.run(clientId, name, "", status, created, deadline, timeSpent);
    projectNameToId.set(name, info.lastInsertRowid);
    projectCount++;
  } catch (e) {
    // ignore
  }
}
console.log(`  Projects imported: ${projectCount}`);

// ─── 4. Import Notion Tasks ───
const tasksCSV = readCSV(`${NOTION_DIR}/Tasks ea15ebc09cec4b3394cce7a39508a0ff_all.csv`);

const insertTask = db.prepare(`
  INSERT INTO tasks (project_id, title, description, status, priority, due_date, notes, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let taskCount = 0;
let sortOrder = 0;

for (const row of tasksCSV) {
  const title = row.Name?.trim();
  if (!title) continue;

  // Find project
  const projectRef = row.Projects || "";
  const projectName = extractName(projectRef);
  const projectId = projectNameToId.get(projectName);

  if (!projectId) continue; // Can't import without project

  const completed = row.Completed?.toLowerCase() === "yes";
  const status = completed ? "done" : parseStatus(row.Status);
  const priority = parsePriority(row.priority);
  const dueDate = parseDate(row.Date);

  // Check if already exists
  const exists = db.prepare("SELECT id FROM tasks WHERE title = ? AND project_id = ?").get(title, projectId);
  if (exists) continue;

  try {
    insertTask.run(projectId, title, "", status, priority, dueDate, "", sortOrder++);
    taskCount++;
  } catch (e) {
    // ignore
  }
}
console.log(`  Tasks imported: ${taskCount}`);

// ─── 5. Import Business Profile ───
console.log("\n=== Setting Business Profile ===");
db.prepare(`
  UPDATE business_profile SET
    owner_name = 'Briguet Loris',
    address = 'Ch. Du Royer 32',
    postal_code = '1978',
    city = 'Lens',
    country = 'CH',
    email = 'contact@lorisbriguet.ch',
    phone = '079 318 67 92',
    ide_number = 'CHE-256.866.188',
    affiliate_number = '078.209.010018',
    bank_name = 'Raiffeisen des Communes du Haut-Plateau',
    bank_address = 'Pl. du Village 4, 1978 Lens',
    iban = 'CH96 8080 8005 9811 1789 8',
    clearing = '80808',
    bic_swift = 'RAIFCH22',
    default_activity = 'Graphisme',
    vat_exempt = 1,
    default_payment_terms_days = 30
  WHERE id = 1
`).run();
console.log("  Business profile updated");

// ─── Summary ───
const summary = {
  clients: db.prepare("SELECT COUNT(*) as n FROM clients").get().n,
  projects: db.prepare("SELECT COUNT(*) as n FROM projects").get().n,
  tasks: db.prepare("SELECT COUNT(*) as n FROM tasks").get().n,
  invoices: db.prepare("SELECT COUNT(*) as n FROM invoices").get().n,
  expenses: db.prepare("SELECT COUNT(*) as n FROM expenses").get().n,
};

console.log("\n=== Migration Complete ===");
console.log(`  Total clients:  ${summary.clients}`);
console.log(`  Total projects: ${summary.projects}`);
console.log(`  Total tasks:    ${summary.tasks}`);
console.log(`  Total invoices: ${summary.invoices}`);
console.log(`  Total expenses: ${summary.expenses}`);

db.close();
