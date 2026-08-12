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

const STRONG_POSITIVE =
  /total\s*ttc|gesamtbetrag|rechnungsbetrag|montant\s*(d[ûu]|total)|à\s*payer|zu\s*zahlen|amount\s*due/i;
const WEAK_POSITIVE = /\btotal\b|\bmontant\b|\bbetrag\b|\bamount\b|\bsumme\b/i;
const NEGATIVE =
  /sous[-\s]?total|subtotal|zwischensumme|\bht\b|hors\s*taxe|\btva\b|mwst|\bvat\b|\btax\b|rabais|rabatt|discount/i;
const CURRENCY = /\bchf\b|\bfr\.?(\s|$)|\beur\b|€/i;

// Money tokens: grouped thousands with 2 decimals, plain 2-decimal numbers,
// or apostrophe-grouped integers (unambiguous Swiss format).
const MONEY_TOKEN =
  /\d{1,3}(?:[.,'\u2019\u00a0 ]\d{3})*[.,]\d{2}|\d+[.,]\d{2}|\d{1,3}(?:['\u2019]\d{3})+/g;
// Integers directly prefixed by a currency marker (e.g. "CHF 25").
const CURRENCY_INT = /(?:chf|fr\.?|eur|€)\s*(\d{1,6})(?![\d.,'])/i;
const DATE_LIKE = /\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}/g;

function detectAmount(lines: string[]): number | undefined {
  const candidates: { value: number; score: number }[] = [];

  const addCandidate = (value: number | null, line: string, index: number) => {
    if (value === null || value <= 0 || value >= 1_000_000) return;
    let score = 0;
    if (STRONG_POSITIVE.test(line)) score += 5;
    else if (WEAK_POSITIVE.test(line)) score += 3;
    if (NEGATIVE.test(line)) score -= 4;
    if (CURRENCY.test(line)) score += 1;
    if (index >= lines.length / 2) score += 1;
    candidates.push({ value, score });
  };

  lines.forEach((line, i) => {
    // Dates and times must not be misread as amounts.
    const cleaned = line.replace(DATE_LIKE, " ");
    let matched = false;
    for (const m of cleaned.matchAll(MONEY_TOKEN)) {
      // Skip percentages like "7.70%".
      const after = cleaned.slice((m.index ?? 0) + m[0].length).trimStart();
      if (after.startsWith("%")) continue;
      matched = true;
      addCandidate(parseAmount(m[0]), line, i);
    }
    if (!matched) {
      const intMatch = cleaned.match(CURRENCY_INT);
      if (intMatch) addCandidate(parseAmount(intMatch[1]), line, i);
    }
  });

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  return Math.round(candidates[0].value * 100) / 100;
}

const DUE_KEYWORDS =
  /[ée]ch[ée]ance|payable\s*jusqu|zahlbar\s*bis|f[äa]llig|due\s*date|payment\s*due|\bdue\b/i;
const INVOICE_DATE_KEYWORDS =
  /date\s*de\s*facture|rechnungsdatum|belegdatum|invoice\s*date|facture\s*du|\bdatum\b|\bdate\b/i;

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2020 && year <= 2030;
}

function collectDates(lines: string[]): { iso: string; line: string }[] {
  const out: { iso: string; line: string }[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/g)) {
      const [, d, mo, yRaw] = m;
      if (yRaw.length === 3) continue;
      const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
      const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      if (isValidDate(iso)) out.push({ iso, line });
    }
    for (const m of line.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
      if (isValidDate(m[0])) out.push({ iso: m[0], line });
    }
  }
  return out;
}

function detectDates(lines: string[]): { invoice_date?: string; due_date?: string } {
  const cands = collectDates(lines);
  if (cands.length === 0) return {};

  const result: { invoice_date?: string; due_date?: string } = {};
  // Due first: "date d'échéance" matches both keyword sets and must be due.
  const due = cands.find((c) => DUE_KEYWORDS.test(c.line));
  const invoice = cands.find(
    (c) => !DUE_KEYWORDS.test(c.line) && INVOICE_DATE_KEYWORDS.test(c.line)
  );
  if (invoice) result.invoice_date = invoice.iso;
  if (due) result.due_date = due.iso;

  if (!result.invoice_date || !result.due_date) {
    // Fallback: unlabeled dates, excluding outliers >1 year from the median.
    const sorted = cands.map((c) => c.iso).sort();
    const times = sorted.map((s) => new Date(s).getTime());
    const median = times[Math.floor(times.length / 2)];
    const YEAR_MS = 366 * 24 * 3600 * 1000;
    const filtered = sorted.filter((_, i) => Math.abs(times[i] - median) <= YEAR_MS);
    if (!result.invoice_date && filtered.length > 0) {
      result.invoice_date = filtered[0];
    }
    if (!result.due_date && filtered.length > 1) {
      const last = filtered[filtered.length - 1];
      if (result.invoice_date && last > result.invoice_date) result.due_date = last;
    }
  }
  return result;
}

/**
 * Parse extracted document text (PDF text layer or OCR output) into
 * expense fields. `knownSuppliers` enables fuzzy supplier matching.
 */
export function parseExpenseFromText(
  text: string,
  knownSuppliers: string[] = []
): ExtractedExpenseData {
  void knownSuppliers; // used from Task 4 on
  const lines = text.split("\n").map((l) => l.trim());
  const result: ExtractedExpenseData = {};

  const amount = detectAmount(lines);
  if (amount !== undefined) result.amount = amount;

  Object.assign(result, detectDates(lines));

  return result;
}
