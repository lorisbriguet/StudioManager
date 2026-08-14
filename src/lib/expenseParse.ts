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

  const addCandidate = (value: number | null, line: string) => {
    if (value === null || value <= 0 || value >= 1_000_000) return;
    let score = 0;
    if (STRONG_POSITIVE.test(line)) score += 5;
    else if (WEAK_POSITIVE.test(line)) score += 3;
    if (NEGATIVE.test(line)) score -= 4;
    if (CURRENCY.test(line)) score += 1;
    candidates.push({ value, score });
  };

  lines.forEach((line) => {
    // Dates and times must not be misread as amounts.
    const cleaned = line.replace(DATE_LIKE, " ");
    let matched = false;
    for (const m of cleaned.matchAll(MONEY_TOKEN)) {
      // Skip percentages like "7.70%".
      const after = cleaned.slice((m.index ?? 0) + m[0].length).trimStart();
      if (after.startsWith("%")) continue;
      matched = true;
      addCandidate(parseAmount(m[0]), line);
    }
    if (!matched) {
      const intMatch = cleaned.match(CURRENCY_INT);
      if (intMatch) addCandidate(parseAmount(intMatch[1]), line);
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

// Month names across EN/FR/DE, normalized (lowercase, diacritics stripped).
const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, janv: 1, janvier: 1, januar: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2, februar: 2,
  mar: 3, march: 3, mars: 3, marz: 3, maerz: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6, juni: 6,
  jul: 7, july: 7, juil: 7, juillet: 7, juli: 7,
  aug: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, okt: 10, oktober: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12, dez: 12, dezember: 12,
};

function monthFromName(token: string): number | null {
  const t = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.+$/, "");
  return MONTH_NAMES[t] ?? null;
}

// "14-JAN-2024", "16 avril 2024", "5. März 2025", "1er janvier 2025"
const DAY_MONTHNAME_YEAR = /(\d{1,2})(?:er)?[.\s-]+([A-Za-zÀ-ÿ]{3,10})[.\s-]+(\d{4})/g;
// "February 5, 2026", "Feb 5, 2026"
const MONTHNAME_DAY_YEAR = /([A-Za-zÀ-ÿ]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g;

interface DateCandidate {
  iso: string;
  line: string;
  lineIndex: number;
}

function collectDates(lines: string[]): DateCandidate[] {
  const out: DateCandidate[] = [];
  lines.forEach((line, lineIndex) => {
    for (const m of line.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/g)) {
      const [, d, mo, yRaw] = m;
      if (yRaw.length === 3) continue;
      const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
      const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      if (isValidDate(iso)) out.push({ iso, line, lineIndex });
    }
    for (const m of line.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
      if (isValidDate(m[0])) out.push({ iso: m[0], line, lineIndex });
    }
    for (const m of line.matchAll(DAY_MONTHNAME_YEAR)) {
      const mo = monthFromName(m[2]);
      if (mo === null) continue;
      const iso = `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      if (isValidDate(iso)) out.push({ iso, line, lineIndex });
    }
    for (const m of line.matchAll(MONTHNAME_DAY_YEAR)) {
      const mo = monthFromName(m[1]);
      if (mo === null) continue;
      const iso = `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      if (isValidDate(iso)) out.push({ iso, line, lineIndex });
    }
  });
  return out;
}

function detectDates(lines: string[]): { invoice_date?: string; due_date?: string } {
  const cands = collectDates(lines);
  if (cands.length === 0) return {};

  const result: { invoice_date?: string; due_date?: string } = {};
  // A label can sit on the date's own line or up to 2 lines above it
  // (e.g. "Date de facturation\n<ref>\n14-JAN-2024").
  const findLabeled = (
    kw: RegExp,
    excluded: (c: DateCandidate) => boolean
  ): DateCandidate | undefined => {
    const sameLine = cands.find((c) => !excluded(c) && kw.test(c.line));
    if (sameLine) return sameLine;
    return cands.find((c) => {
      if (excluded(c)) return false;
      for (let d = 1; d <= 2; d++) {
        const above = lines[c.lineIndex - d];
        if (above && kw.test(above)) return true;
      }
      return false;
    });
  };

  // Due first: "date d'échéance" matches both keyword sets and must be due.
  const due = findLabeled(DUE_KEYWORDS, () => false);
  const invoice = findLabeled(
    INVOICE_DATE_KEYWORDS,
    (c) => c === due || DUE_KEYWORDS.test(c.line)
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

export const LEGAL_SUFFIXES = new Set([
  "sa", "sarl", "gmbh", "ag", "sas", "ltd", "inc", "llc", "kg", "srl", "co",
]);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Fuzzy-match document text against known supplier names.
 * A supplier matches when all its significant tokens (legal suffixes
 * stripped) appear as whole words in the text. Returns the canonical
 * DB name so downstream category autofill fires.
 */
export function matchKnownSupplier(
  text: string,
  knownSuppliers: string[]
): string | null {
  const haystack = ` ${normalizeText(text)} `;
  // Longer names first so "Coop Pronto" beats "Coop".
  const sorted = [...knownSuppliers].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const tokens = normalizeText(name)
      .split(" ")
      .filter((t) => t && !LEGAL_SUFFIXES.has(t));
    if (tokens.length === 0 || !tokens.some((t) => t.length >= 3)) continue;
    if (tokens.every((t) => haystack.includes(` ${t} `))) return name;
  }
  return null;
}

function detectSupplier(
  text: string,
  lines: string[],
  knownSuppliers: string[]
): string | undefined {
  const known = matchKnownSupplier(text, knownSuppliers);
  if (known) return known;

  const supplierPatterns = [
    /(?:four(?:nisseur|\.?\s*de\s*prestations)?|fournisseur|supplier|lieferant)\s*[:.]?\s*(.+)/i,
    /(?:auteur\s*facture|biller|rechnungssteller)\s*[:.]?\s*(.+)/i,
  ];
  for (const pattern of supplierPatterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name.length >= 3 && name.length <= 80) return name;
    }
  }

  // Fallback: first prominent text line (skip OCR noise and headers).
  const nonEmpty = lines.filter((l) => l.length > 2);
  for (const line of nonEmpty.slice(0, 15)) {
    if (/^\d/.test(line)) continue;
    if (/^(facture|invoice|rechnung|quittung|receipt|page|date|total|ref|n°|cette|veuillez|destinataire)/i.test(line)) continue;
    if (/chf|fr\.|montant|amount|tva/i.test(line)) continue;
    const alphaRatio = (line.match(/[a-zA-ZÀ-ÿ]/g) || []).length / line.length;
    if (alphaRatio < 0.5) continue;
    if (line.length < 5) continue;
    if (line.length <= 80) return line;
  }
  return undefined;
}

/**
 * Parse extracted document text (PDF text layer or OCR output) into
 * expense fields. `knownSuppliers` enables fuzzy supplier matching.
 */
export function parseExpenseFromText(
  text: string,
  knownSuppliers: string[] = []
): ExtractedExpenseData {
  const lines = text.split("\n").map((l) => l.trim());
  const result: ExtractedExpenseData = {};

  const amount = detectAmount(lines);
  if (amount !== undefined) result.amount = amount;

  Object.assign(result, detectDates(lines));

  const supplier = detectSupplier(text, lines, knownSuppliers);
  if (supplier) result.supplier = supplier;

  return result;
}
