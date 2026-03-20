import { Command } from "@tauri-apps/plugin-shell";
import { logError } from "./log";

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

  // Try to find supplier name — usually the first prominent text line
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
  for (const line of lines.slice(0, 5)) {
    // Skip lines that look like dates, amounts, or common headers
    if (/^\d/.test(line)) continue;
    if (/^(facture|invoice|rechnung|quittung|receipt|page|date|total|ref)/i.test(line)) continue;
    if (/chf|fr\.|montant|amount/i.test(line)) continue;
    // Use the first non-trivial text line as supplier
    if (line.length >= 3 && line.length <= 80) {
      result.supplier = line;
      break;
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
