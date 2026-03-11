/**
 * Script to attach existing invoice PDF files to invoices in the database.
 * Maps PDF files from Compta folders to invoices by matching references.
 */
import fs from "fs";
import path from "path";
import os from "os";
import betterSqlite3 from "better-sqlite3";

const homeDir = os.homedir();

// Find the database
const possibleDbPaths = [
  path.join(homeDir, "Library/Application Support/ch.lorisbriguet.studiomanager/studiomanager.db"),
  path.join(homeDir, "Library/Application Support/com.studiomanager.app/studiomanager.db"),
];

let dbPath = null;
for (const p of possibleDbPaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error("Could not find studiomanager.db");
  process.exit(1);
}

console.log("Found database at:", dbPath);
const db = betterSqlite3(dbPath);

// Destination directory for invoice PDFs
const appDataDir = path.dirname(dbPath);
const invoicesDir = path.join(appDataDir, "invoices");
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
  console.log("Created invoices directory:", invoicesDir);
}

// Source folders for invoice PDFs
const invoiceSources = [
  // 2024 folder has 2023 and 2024 invoices with "Facture_" prefix
  {
    dir: path.join(homeDir, "Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2024/Factures Encaissées"),
    pattern: "prefix", // Facture_2023-010.pdf
  },
  // 2025 encaissées - files like 2025-001.pdf or 2025-007_Ludo.pdf
  {
    dir: path.join(homeDir, "Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2025/Factures encaissées"),
    pattern: "startsWith",
  },
  // 2025 émises - files like 2025-0017_ArtBasel.pdf
  {
    dir: path.join(homeDir, "Library/CloudStorage/SynologyDrive-02_SD/00_Personal/WorkFiles/Compta/2025/Factures émises"),
    pattern: "startsWith",
  },
  // 2026 encaissées - files like F2026-001_Romandie.pdf
  {
    dir: path.join(homeDir, "Downloads/indépendant /Factures encaissées"),
    pattern: "startsWith",
  },
  // 2026 émises
  {
    dir: path.join(homeDir, "Downloads/indépendant /Factures émises"),
    pattern: "startsWith",
  },
];

// Get all invoices
const invoices = db.prepare("SELECT id, reference, pdf_path FROM invoices").all();
console.log(`Found ${invoices.length} invoices in database`);

let matched = 0;
let skipped = 0;
let notFound = 0;

for (const inv of invoices) {
  if (inv.pdf_path) {
    skipped++;
    continue;
  }

  const ref = inv.reference; // e.g. "2025-001"
  let sourceFile = null;

  for (const source of invoiceSources) {
    if (!fs.existsSync(source.dir)) continue;

    const files = fs.readdirSync(source.dir);
    for (const file of files) {
      if (!file.endsWith(".pdf")) continue;
      const fileLower = file.toLowerCase();
      const refLower = ref.toLowerCase();

      // Match patterns:
      // "Facture_2025-001.pdf" -> prefix match
      // "2025-001.pdf" or "2025-001_Client.pdf" -> startsWith match
      // "F2026-001_Client.pdf" -> startsWith with F prefix
      // Also handle zero-padded refs: "2025-0010" should match "2025-010"

      // Normalize ref for matching: "2025-001"
      const refParts = ref.match(/^(\d{4})-(\d+)$/);
      if (!refParts) continue;
      const refYear = refParts[1];
      const refNum = parseInt(refParts[2]);

      // Try to extract year-number from filename
      // Patterns: Facture_YYYY-NNN, YYYY-NNN, YYYY-NNNN, FYYYY-NNN
      const fileMatch = file.match(/(?:Facture_|F)?(\d{4})-0*(\d+)/i);
      if (fileMatch) {
        const fileYear = fileMatch[1];
        const fileNum = parseInt(fileMatch[2]);
        if (fileYear === refYear && fileNum === refNum) {
          sourceFile = path.join(source.dir, file);
          break;
        }
      }
    }
    if (sourceFile) break;
  }

  if (!sourceFile) {
    console.log(`  No PDF found for ${ref}`);
    notFound++;
    continue;
  }

  const destFile = path.join(invoicesDir, `${ref}.pdf`);
  try {
    fs.copyFileSync(sourceFile, destFile);
    db.prepare("UPDATE invoices SET pdf_path = ? WHERE id = ?").run(destFile, inv.id);
    matched++;
    console.log(`  Attached ${ref} <- ${path.basename(sourceFile)}`);
  } catch (err) {
    console.error(`  Error copying ${ref}: ${err.message}`);
  }
}

console.log("\nDone!");
console.log(`  Matched & attached: ${matched}`);
console.log(`  Already had PDF: ${skipped}`);
console.log(`  Not found: ${notFound}`);
console.log(`  Total invoices: ${invoices.length}`);

db.close();
