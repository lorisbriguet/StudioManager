// Receipt-parsing evaluation against recorded data.
//
// For every expense with an attached receipt, re-extract the document text
// with the SAME native pipeline the app uses (PDFKit text layer for PDFs,
// Apple Vision OCR for images — identical fixed JXA scripts to
// src-tauri/src/apple.rs), run the parser, and compare supplier / amount /
// invoice date against the recorded (user-corrected) values.
//
// Run:  node --experimental-strip-types scripts/eval-receipts.mjs
// Read-only: never writes to the database or the receipts.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

const DB = `${os.homedir()}/Library/Application Support/ch.studiomanager.app/studiomanager.db`;

const PDF_TEXT_JXA = `
function run(argv) {
  ObjC.import('PDFKit');
  ObjC.import('Foundation');
  var url = $.NSURL.fileURLWithPath($(argv[0]));
  var doc = $.PDFDocument.alloc.initWithURL(url);
  if (!doc || doc.isNil()) return '';
  var text = '';
  for (var i = 0; i < doc.pageCount; i++) {
    var page = doc.pageAtIndex(i);
    if (page) { var s = page.string; if (s) text += s.js + String.fromCharCode(10); }
  }
  return text;
}
`;

const OCR_VISION_JXA = `
function run(argv) {
  ObjC.import('Vision');
  ObjC.import('Foundation');
  var url = $.NSURL.fileURLWithPath($(argv[0]));
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
  var request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = true;
  request.recognitionLanguages = $(['fr-FR', 'de-DE', 'en-US']);
  var error = Ref();
  var ok = handler.performRequestsError($([request]), error);
  if (!ok) throw new Error('Vision request failed');
  var results = request.results;
  var lines = [];
  for (var i = 0; i < results.count; i++) {
    var top = results.objectAtIndex(i).topCandidates(1);
    if (top.count > 0) lines.push(top.objectAtIndex(0).string.js);
  }
  return lines.join(String.fromCharCode(10));
}
`;

function sql(query) {
  const out = execFileSync("sqlite3", ["-json", DB, query]).toString().trim();
  return out ? JSON.parse(out) : [];
}

function extractText(path) {
  const isPdf = path.toLowerCase().endsWith(".pdf");
  const script = isPdf ? PDF_TEXT_JXA : OCR_VISION_JXA;
  return execFileSync("osascript", ["-l", "JavaScript", "-e", script, path], {
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  }).toString().trim();
}

const { parseExpenseFromText } = await import("../src/lib/expenseParse.ts");

const expenses = sql(
  "SELECT id, supplier, amount, invoice_date, receipt_path FROM expenses WHERE receipt_path IS NOT NULL AND receipt_path <> ''"
);
const supplierNames = sql("SELECT DISTINCT supplier FROM expenses").map((r) => r.supplier);

const stats = {
  pdf: { total: 0, supplier: 0, amount: 0, date: 0 },
  image: { total: 0, supplier: 0, amount: 0, date: 0 },
};
const misses = [];
let unreadable = 0;

for (const exp of expenses) {
  if (!existsSync(exp.receipt_path)) {
    unreadable++;
    continue;
  }
  const kind = exp.receipt_path.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
  let text = "";
  try {
    text = extractText(exp.receipt_path);
  } catch {
    unreadable++;
    continue;
  }
  const parsed = parseExpenseFromText(text, supplierNames);
  const s = stats[kind];
  s.total++;

  const supplierOk =
    parsed.supplier != null &&
    parsed.supplier.trim().toLowerCase() === exp.supplier.trim().toLowerCase();
  const amountOk = parsed.amount != null && Math.abs(parsed.amount - exp.amount) < 0.01;
  const dateOk = parsed.invoice_date === exp.invoice_date;
  if (supplierOk) s.supplier++;
  if (amountOk) s.amount++;
  if (dateOk) s.date++;
  if (!supplierOk || !amountOk || !dateOk) {
    misses.push(
      `#${exp.id} [${kind}] ${exp.supplier}: ` +
        (supplierOk ? "" : `supplier "${parsed.supplier ?? "-"}" `) +
        (amountOk ? "" : `amount ${parsed.amount ?? "-"}≠${exp.amount} `) +
        (dateOk ? "" : `date ${parsed.invoice_date ?? "-"}≠${exp.invoice_date}`)
    );
  }
}

const pct = (n, d) => (d === 0 ? "  n/a" : `${String(Math.round((n / d) * 100)).padStart(3)}%`);
const line = (label, s) =>
  console.log(
    `${label.padEnd(18)} n=${String(s.total).padStart(3)}  supplier ${pct(s.supplier, s.total)}  amount ${pct(s.amount, s.total)}  date ${pct(s.date, s.total)}`
  );

console.log("── Receipt parsing eval (recorded data = ground truth) ──");
line("PDF (PDFKit text)", stats.pdf);
line("Image (Vision OCR)", stats.image);
const all = {
  total: stats.pdf.total + stats.image.total,
  supplier: stats.pdf.supplier + stats.image.supplier,
  amount: stats.pdf.amount + stats.image.amount,
  date: stats.pdf.date + stats.image.date,
};
line("All", all);
if (unreadable > 0) console.log(`(${unreadable} receipts missing on disk or unreadable)`);
if (process.argv.includes("--verbose")) {
  console.log("\nMismatches:");
  for (const m of misses) console.log("  " + m);
}
