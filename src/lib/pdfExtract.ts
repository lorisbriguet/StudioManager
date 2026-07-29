import { Command } from "@tauri-apps/plugin-shell";
import { readFile, remove } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { logError } from "./log";

/** Escape a string for embedding in an AppleScript double-quoted literal. */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Singleton OCR worker — lazy-loaded to avoid ~300KB bundle cost upfront.
// Reused across calls to avoid re-downloading ~15MB language data each time.
let ocrWorker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;

/**
 * True once the OCR worker singleton has been created. Lets callers show a
 * "first run downloads language data" hint before the initial (slow) init.
 */
export function isOcrWorkerReady(): boolean {
  return ocrWorker !== null;
}

async function getOCRWorker() {
  if (!ocrWorker) {
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("fra+eng");
  }
  return ocrWorker;
}

/**
 * Extract text from a PDF using macOS built-in JXA (JavaScript for Automation)
 * which has native access to PDFKit via the ObjC bridge — no Python dependencies.
 */
export async function extractPdfText(filePath: string): Promise<string> {
  const safePath = filePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const script = `
ObjC.import('PDFKit');
ObjC.import('Foundation');
var url = $.NSURL.fileURLWithPath($('${safePath}'));
var doc = $.PDFDocument.alloc.initWithURL(url);
if (!doc || doc.isNil()) { ''; } else {
  var text = '';
  for (var i = 0; i < doc.pageCount; i++) {
    var page = doc.pageAtIndex(i);
    if (page) {
      var s = page.string;
      if (s) text += s.js + String.fromCharCode(10);
    }
  }
  text;
}
`.trim();

  const cmd = Command.create("osascript-jxa", ["-l", "JavaScript", "-e", script]);
  const result = await Promise.race([
    cmd.execute(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("PDF extraction timed out")), 15000)
    ),
  ]);

  if (result.code !== 0) {
    logError("PDF extraction failed:", result.stderr);
    return "";
  }

  return result.stdout.trim();
}

/**
 * Convert HEIC to JPEG using macOS built-in sips command.
 * Returns the path to the converted JPEG file.
 */
async function convertHeicToJpeg(filePath: string): Promise<Uint8Array> {
  // Write the converted JPEG into APPDATA: the fs scope covers APPDATA but
  // not arbitrary sibling paths of the picked file (dialog/drag-drop only
  // allows the picked file itself). sips runs via shell, outside fs scope,
  // but the readFile below goes through the fs plugin.
  const outPath = `${await appDataDir()}/temp_heic_converted_${crypto.randomUUID()}.jpg`;
  // The paths reach the shell via AppleScript's `quoted form of`, which
  // safely quotes spaces, single quotes and shell metacharacters;
  // escapeAppleScript covers the outer AppleScript string-literal layer.
  const script =
    `do shell script "sips -s format jpeg " & quoted form of "${escapeAppleScript(filePath)}"` +
    ` & " --out " & quoted form of "${escapeAppleScript(outPath)}"`;
  const cmd = Command.create("osascript", ["-e", script]);
  try {
    const result = await cmd.execute();
    if (result.code !== 0) {
      throw new Error(`HEIC conversion failed: ${result.stderr}`);
    }
    return await readFile(outPath);
  } finally {
    // Always clean up the temp file; it is in APPDATA (in fs scope), so the
    // fs plugin's remove() works — no extra shell-quoting context needed.
    await remove(outPath).catch(() => {});
  }
}

/**
 * Extract text from an image using Tesseract.js OCR (browser-based, web worker).
 * Supports JPEG, PNG, and HEIC (converted via macOS sips).
 * Language data (~15MB) is cached after first use.
 * 15s timeout to match PDF extraction.
 */
export async function extractImageText(filePath: string): Promise<string> {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const bytes = ext === "heic" ? await convertHeicToJpeg(filePath) : await readFile(filePath);
  const blob = new Blob([new Uint8Array(bytes)]);

  const worker = await getOCRWorker();
  const result = await Promise.race([
    worker.recognize(blob),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timed out")), 15000)
    ),
  ]);
  return result.data.text.trim();
}

export interface ExtractedExpenseData {
  supplier?: string;
  amount?: number;
  invoice_date?: string;
  due_date?: string;
}

/**
 * Parse extracted PDF text and try to find expense-related fields.
 */
export function parseExpenseFromText(text: string): ExtractedExpenseData {
  const result: ExtractedExpenseData = {};

  // Try to find amount — look for CHF amounts or total patterns
  const amountPatterns = [
    /(?:total|montant|amount|betrag|gesamt)\s*(?:ttc|ht|net)?\s*[:.]?\s*(?:chf|fr\.?)?\s*([\d'\u2019., ]+\d)/i,
    /(?:chf|fr\.?)\s*([\d'\u2019., ]+\d)\s*$/im,
    /(?:total|montant|amount)\s*[:.]?\s*([\d'\u2019., ]+\d)/i,
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].replace(/['\u2019\s]/g, "").replace(",", ".");
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0 && num < 1_000_000) {
        result.amount = Math.round(num * 100) / 100;
        break;
      }
    }
  }

  // Try to find dates (dd.mm.yyyy or yyyy-mm-dd patterns)
  const datePattern = /(\d{1,2})[./](\d{1,2})[./](\d{4})/g;
  const isoDatePattern = /(\d{4})-(\d{2})-(\d{2})/g;
  const dates: string[] = [];

  let m;
  while ((m = datePattern.exec(text)) !== null) {
    const [, d, mo, y] = m;
    const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (isValidDate(date)) dates.push(date);
  }
  while ((m = isoDatePattern.exec(text)) !== null) {
    const date = m[0];
    if (isValidDate(date)) dates.push(date);
  }

  if (dates.length > 0) {
    // Sort dates, use earliest as invoice date
    dates.sort();
    result.invoice_date = dates[0];
    if (dates.length > 1) {
      result.due_date = dates[dates.length - 1];
    }
  }

  // Try to find supplier name
  // First, look for labeled supplier patterns
  const supplierPatterns = [
    /(?:four(?:nisseur|\.?\s*de\s*prestations)?|fournisseur|supplier|lieferant)\s*[:.]?\s*(.+)/i,
    /(?:auteur\s*facture|biller|rechnungssteller)\s*[:.]?\s*(.+)/i,
  ];
  for (const pattern of supplierPatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name.length >= 3 && name.length <= 80) {
        result.supplier = name;
        break;
      }
    }
  }

  // Fallback: first prominent text line (skip OCR noise)
  if (!result.supplier) {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
    for (const line of lines.slice(0, 15)) {
      if (/^\d/.test(line)) continue;
      if (/^(facture|invoice|rechnung|quittung|receipt|page|date|total|ref|n°|cette|veuillez|destinataire)/i.test(line)) continue;
      if (/chf|fr\.|montant|amount|tva/i.test(line)) continue;
      // Skip lines with too many special chars (OCR garbage)
      const alphaRatio = (line.match(/[a-zA-ZÀ-ÿ]/g) || []).length / line.length;
      if (alphaRatio < 0.5) continue;
      // Skip very short lines (likely OCR fragments)
      if (line.length < 5) continue;
      if (line.length <= 80) {
        result.supplier = line;
        break;
      }
    }
  }

  return result;
}

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2020 && year <= 2030;
}
