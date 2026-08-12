// Pure text-parsing helpers for expense extraction.
// No Tauri imports — keep this module unit-testable.

export interface ExtractedExpenseData {
  supplier?: string;
  amount?: number;
  invoice_date?: string;
  due_date?: string;
}

/**
 * Normalize a raw money token into a number.
 * Handles: 1'234.56 (CH), 1.234,56 (DE), 1 234,56 (FR), 1,234.56 (EN).
 * Rule: a trailing separator group of 1-2 digits is the decimal part;
 * all other separators are thousands separators.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/['\u2019\s\u00a0]/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (lastSep !== -1) {
    const decimals = s.length - lastSep - 1;
    if (decimals >= 1 && decimals <= 2) {
      s = s.slice(0, lastSep).replace(/[.,]/g, "") + "." + s.slice(lastSep + 1);
    } else {
      s = s.replace(/[.,]/g, "");
    }
  }
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : null;
}
