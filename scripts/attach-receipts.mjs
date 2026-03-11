/**
 * Script to attach existing expense proof files to expenses in the database.
 * Maps receipt files from Compta folders to expenses by matching references (F-24-001, F-25-001, etc.)
 */
import Database from "@tauri-apps/plugin-sql";
import { copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";

// Since we can't use Tauri APIs outside the app, we'll use Node.js directly
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";
import betterSqlite3 from "better-sqlite3";

// Find the SQLite database
const homeDir = os.homedir();

// Tauri v2 stores app data in different places depending on platform
// macOS: ~/Library/Application Support/com.studiomanager.app/
// Let's find it
const possibleDbPaths = [
  path.join(homeDir, "Library/Application Support/com.studiomanager.app/studiomanager.db"),
  path.join(homeDir, "Library/Application Support/studio-manager/studiomanager.db"),
  path.join(homeDir, "Library/Application Support/StudioManager/studiomanager.db"),
];

let dbPath = null;
for (const p of possibleDbPaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

// Also try to find it via find command if not in expected locations
if (!dbPath) {
  // Search more broadly
  const searchPaths = [
    path.join(homeDir, "Library/Application Support"),
  ];
  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue;
    const entries = fs.readdirSync(searchPath);
    for (const entry of entries) {
      const candidate = path.join(searchPath, entry, "studiomanager.db");
      if (fs.existsSync(candidate)) {
        dbPath = candidate;
        break;
      }
    }
    if (dbPath) break;
  }
}

if (!dbPath) {
  console.error("Could not find studiomanager.db. Searched:");
  possibleDbPaths.forEach((p) => console.error("  -", p));
  console.error("Please provide the path as first argument.");
  process.exit(1);
}

console.log("Found database at:", dbPath);

const db = betterSqlite3(dbPath);

// Source folders for receipt files
const receiptSources = {
  2024: "/Users/loris.briguet/Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2024/Frais d_activité",
  2025: "/Users/loris.briguet/Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2025/Frais d_activité",
  2026: "/Users/loris.briguet/Downloads/indépendant /Frais d_activité",
};

// Justificatifs folders (social charges, bank docs, etc.)
const justificatifSources = {
  2024: "/Users/loris.briguet/Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2024/Justificatifs",
  2025: "/Users/loris.briguet/Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2025/Justificatifs",
};

// Destination directory for receipts within app data
const appDataDir = path.dirname(dbPath);
const receiptsDir = path.join(appDataDir, "receipts");

if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
  console.log("Created receipts directory:", receiptsDir);
}

// Get all expenses from DB
const expenses = db.prepare("SELECT id, reference, receipt_path FROM expenses").all();
console.log(`Found ${expenses.length} expenses in database`);

let matched = 0;
let skipped = 0;
let notFound = 0;

for (const expense of expenses) {
  // Skip if already has a receipt
  if (expense.receipt_path) {
    skipped++;
    continue;
  }

  const ref = expense.reference; // e.g. "F-25-001"

  // Parse year from reference
  const yearMatch = ref.match(/F-(\d{2})-/);
  if (!yearMatch) {
    console.log(`  Skipping ${ref}: unrecognized format`);
    notFound++;
    continue;
  }

  const yearShort = yearMatch[1];
  const yearFull = 2000 + parseInt(yearShort);

  // Look for the file in the appropriate source folder
  const sourceDir = receiptSources[yearFull];
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    console.log(`  No source folder for year ${yearFull}`);
    notFound++;
    continue;
  }

  // Try common extensions
  let sourceFile = null;
  for (const ext of ["pdf", "png", "jpg", "jpeg"]) {
    const candidate = path.join(sourceDir, `${ref}.${ext}`);
    if (fs.existsSync(candidate)) {
      sourceFile = candidate;
      break;
    }
  }

  if (!sourceFile) {
    console.log(`  No receipt found for ${ref}`);
    notFound++;
    continue;
  }

  // Copy to receipts directory
  const ext = path.extname(sourceFile);
  const destFile = path.join(receiptsDir, `${ref}${ext}`);

  try {
    fs.copyFileSync(sourceFile, destFile);

    // Update database
    db.prepare("UPDATE expenses SET receipt_path = ? WHERE id = ?").run(destFile, expense.id);

    matched++;
    console.log(`  Attached ${ref}${ext}`);
  } catch (err) {
    console.error(`  Error copying ${ref}: ${err.message}`);
  }
}

console.log("\nDone!");
console.log(`  Matched & attached: ${matched}`);
console.log(`  Already had receipt: ${skipped}`);
console.log(`  Not found: ${notFound}`);
console.log(`  Total expenses: ${expenses.length}`);

db.close();
