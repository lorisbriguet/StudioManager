# Expense Text Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the first-match-wins regex expense parser with a candidate-scoring parser (amount, dates, supplier) in a new pure module, fixing wrong amounts/dates/suppliers.

**Architecture:** New pure module `src/lib/expenseParse.ts` (no Tauri imports) holds all parsing. `src/lib/pdfExtract.ts` keeps only extraction plumbing (PDFKit JXA, Tesseract, HEIC). `ExpensesPage.tsx` passes known supplier names into the parser for fuzzy matching.

**Tech Stack:** TypeScript, vitest (already configured), Tauri v2 + React 19 app.

**Spec:** `docs/superpowers/specs/2026-08-12-expense-parser-design.md`

## Global Constraints

- No new dependencies.
- `src/lib/expenseParse.ts` must have zero Tauri imports (pure, unit-testable).
- Everything stays local — no cloud APIs.
- Tests live in `src/__tests__/` (project convention; supersedes the spec's `src/lib/__tests__/`).
- Run a single test file: `npx vitest run src/__tests__/expenseParse.test.ts` (from repo root `/Users/loris.briguet/Documents/GitHub/StudioManager`).
- Amount validation: `0 < x < 1_000_000`, rounded to 2 decimals. Date validity: years 2020–2030.

---

### Task 1: `parseAmount` number normalizer

**Files:**
- Create: `src/lib/expenseParse.ts`
- Test: `src/__tests__/expenseParse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function parseAmount(raw: string): number | null` and `export interface ExtractedExpenseData { supplier?: string; amount?: number; invoice_date?: string; due_date?: string }` — used by Tasks 2–5.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/expenseParse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAmount } from "../lib/expenseParse";

describe("parseAmount", () => {
  it("parses Swiss apostrophe thousands", () => {
    expect(parseAmount("1'234.56")).toBe(1234.56);
    expect(parseAmount("12'450.00")).toBe(12450);
    expect(parseAmount("1'000")).toBe(1000);
  });

  it("parses German format (dot thousands, comma decimal)", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1.309,00")).toBe(1309);
  });

  it("parses French format (space thousands, comma decimal)", () => {
    expect(parseAmount("1 234,56")).toBe(1234.56);
  });

  it("parses English format (comma thousands, dot decimal)", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });

  it("parses plain decimals and integers", () => {
    expect(parseAmount("234.56")).toBe(234.56);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("1500")).toBe(1500);
  });

  it("treats a trailing 3-digit group as thousands, not decimals", () => {
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("12.345")).toBe(12345);
  });

  it("returns null for non-numeric input", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: FAIL — cannot resolve `../lib/expenseParse`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/expenseParse.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/expenseParse.ts src/__tests__/expenseParse.test.ts
git commit -m "feat: add multi-format money normalizer for expense parsing"
```

---

### Task 2: Amount detection with candidate scoring

**Files:**
- Modify: `src/lib/expenseParse.ts`
- Test: `src/__tests__/expenseParse.test.ts`

**Interfaces:**
- Consumes: `parseAmount` from Task 1.
- Produces: `export function parseExpenseFromText(text: string, knownSuppliers?: string[]): ExtractedExpenseData` — at this stage only `amount` is populated; Tasks 3–4 extend it. The optional `knownSuppliers` parameter exists from the start (unused until Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/expenseParse.test.ts` (add `parseExpenseFromText` to the existing import):

```ts
import { parseAmount, parseExpenseFromText } from "../lib/expenseParse";

const FR_INVOICE = `Boulangerie Dupont Sàrl
Rue du Marché 12
1204 Genève
Facture N° 2025-114
Date de facture: 15.03.2025
Échéance: 14.04.2025
Croissants x 20    45.00
Pain complet       12.50
Sous-total         57.50
TVA 2.6%            1.50
Total TTC CHF      59.00`;

const DE_INVOICE = `Bürobedarf München GmbH
Rechnungsdatum: 03.02.2025
Zahlbar bis: 03.03.2025
Zwischensumme 1.100,00
MwSt 19% 209,00
Gesamtbetrag EUR 1.309,00`;

const EN_RECEIPT = `STAPLES STORE #142
25/07/2025 14:32
Paper A4 24.99
Subtotal 24.99
Tax 1.87
Total 26.86`;

const CH_INVOICE = `Atelier Weber AG
Rechnung 2025-33
Datum: 10.01.2025
Total CHF 12'450.00`;

describe("parseExpenseFromText — amount", () => {
  it("prefers the labeled total over subtotals and line items (FR)", () => {
    expect(parseExpenseFromText(FR_INVOICE).amount).toBe(59.0);
  });

  it("prefers Gesamtbetrag over Zwischensumme and MwSt (DE)", () => {
    expect(parseExpenseFromText(DE_INVOICE).amount).toBe(1309.0);
  });

  it("prefers Total over Subtotal and Tax (EN receipt)", () => {
    expect(parseExpenseFromText(EN_RECEIPT).amount).toBe(26.86);
  });

  it("parses Swiss apostrophe amounts in context", () => {
    expect(parseExpenseFromText(CH_INVOICE).amount).toBe(12450.0);
  });

  it("picks up currency-prefixed integers", () => {
    expect(parseExpenseFromText("Parking\nTotal CHF 25").amount).toBe(25);
  });

  it("ignores dates and percentages as amounts", () => {
    expect(parseExpenseFromText("Facture du 15.03.2025\nTVA 7.7%").amount).toBeUndefined();
  });

  it("rejects out-of-range amounts", () => {
    expect(parseExpenseFromText("Total CHF 2'500'000.00").amount).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: FAIL — `parseExpenseFromText` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/expenseParse.ts`:

```ts
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

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/expenseParse.ts src/__tests__/expenseParse.test.ts
git commit -m "feat: score-based amount detection for expense parsing"
```

---

### Task 3: Label-aware date detection

**Files:**
- Modify: `src/lib/expenseParse.ts`
- Test: `src/__tests__/expenseParse.test.ts`

**Interfaces:**
- Consumes: `parseExpenseFromText` from Task 2 (fixtures `FR_INVOICE`, `DE_INVOICE`, `EN_RECEIPT`, `CH_INVOICE` already in the test file).
- Produces: `parseExpenseFromText` now also fills `invoice_date` and `due_date` (ISO `yyyy-mm-dd` strings).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/expenseParse.test.ts`:

```ts
describe("parseExpenseFromText — dates", () => {
  it("uses labeled invoice and due dates (FR)", () => {
    const r = parseExpenseFromText(FR_INVOICE);
    expect(r.invoice_date).toBe("2025-03-15");
    expect(r.due_date).toBe("2025-04-14");
  });

  it("uses labeled invoice and due dates (DE)", () => {
    const r = parseExpenseFromText(DE_INVOICE);
    expect(r.invoice_date).toBe("2025-02-03");
    expect(r.due_date).toBe("2025-03-03");
  });

  it("falls back to the only date for unlabeled receipts", () => {
    const r = parseExpenseFromText(EN_RECEIPT);
    expect(r.invoice_date).toBe("2025-07-25");
    expect(r.due_date).toBeUndefined();
  });

  it("expands two-digit years on till receipts", () => {
    const r = parseExpenseFromText("Kiosk Bahnhof\n15.06.25 09:12\nTotal CHF 4.50");
    expect(r.invoice_date).toBe("2025-06-15");
  });

  it("excludes far-out outlier dates in fallback mode", () => {
    const text = "Garage Blanc\n01.03.2025\n31.03.2025\nOffre valable jusqu'au 01.01.2030";
    const r = parseExpenseFromText(text);
    expect(r.invoice_date).toBe("2025-03-01");
    expect(r.due_date).toBe("2025-03-31");
  });

  it("does not pair a labeled invoice date with an outlier due date", () => {
    const text = "Atelier X\nDate de facture: 01.03.2025\nValable jusqu'au 01.01.2030";
    const r = parseExpenseFromText(text);
    expect(r.invoice_date).toBe("2025-03-01");
    expect(r.due_date).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: FAIL — date fields are undefined.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/expenseParse.ts`, and call `detectDates` from `parseExpenseFromText`:

```ts
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
```

In `parseExpenseFromText`, after the amount block, add:

```ts
  Object.assign(result, detectDates(lines));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/expenseParse.ts src/__tests__/expenseParse.test.ts
git commit -m "feat: label-aware invoice/due date detection with outlier filtering"
```

---

### Task 4: Supplier detection with fuzzy known-supplier matching

**Files:**
- Modify: `src/lib/expenseParse.ts`
- Test: `src/__tests__/expenseParse.test.ts`

**Interfaces:**
- Consumes: `parseExpenseFromText(text, knownSuppliers)` signature from Task 2.
- Produces: `export function matchKnownSupplier(text: string, knownSuppliers: string[]): string | null`; `parseExpenseFromText` now fills `supplier`. Task 5 relies on the canonical-DB-name return behavior.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/expenseParse.test.ts` (add `matchKnownSupplier` to the import):

```ts
import { parseAmount, parseExpenseFromText, matchKnownSupplier } from "../lib/expenseParse";
```

```ts
describe("matchKnownSupplier", () => {
  it("matches a known supplier ignoring legal suffixes and diacritics", () => {
    const text = "Migros Genève Plainpalais\nQuittung 2025";
    expect(matchKnownSupplier(text, ["Migros SA"])).toBe("Migros SA");
  });

  it("matches multi-token names when all tokens appear", () => {
    const text = "Facture — Atelier Weber, Zürich";
    expect(matchKnownSupplier(text, ["Atelier Weber AG"])).toBe("Atelier Weber AG");
  });

  it("prefers longer, more specific names", () => {
    const text = "Coop Pronto Lausanne Gare";
    expect(matchKnownSupplier(text, ["Coop", "Coop Pronto"])).toBe("Coop Pronto");
  });

  it("returns null when no known supplier appears", () => {
    expect(matchKnownSupplier("Boulangerie Dupont", ["Migros SA"])).toBeNull();
  });

  it("does not match on short/legal-only tokens", () => {
    expect(matchKnownSupplier("Rapport SA 2025", ["SA"])).toBeNull();
  });
});

describe("parseExpenseFromText — supplier", () => {
  it("returns the canonical known-supplier name when fuzzy-matched", () => {
    const r = parseExpenseFromText(FR_INVOICE, ["Boulangerie Dupont Sàrl", "Migros SA"]);
    expect(r.supplier).toBe("Boulangerie Dupont Sàrl");
  });

  it("uses labeled supplier patterns when no known supplier matches", () => {
    const r = parseExpenseFromText("Quittung\nLieferant: Muster AG\nTotal CHF 10.00");
    expect(r.supplier).toBe("Muster AG");
  });

  it("falls back to the first prominent line", () => {
    expect(parseExpenseFromText(DE_INVOICE).supplier).toBe("Bürobedarf München GmbH");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: FAIL — `matchKnownSupplier` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/expenseParse.ts`:

```ts
const LEGAL_SUFFIXES = new Set([
  "sa", "sarl", "gmbh", "ag", "sas", "ltd", "inc", "llc", "kg", "srl", "co",
]);

function normalizeText(s: string): string {
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
```

In `parseExpenseFromText`: remove the `void knownSuppliers;` line and add before `return result;`:

```ts
  const supplier = detectSupplier(text, lines, knownSuppliers);
  if (supplier) result.supplier = supplier;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/expenseParse.test.ts`
Expected: PASS (28 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/expenseParse.ts src/__tests__/expenseParse.test.ts
git commit -m "feat: fuzzy known-supplier matching with labeled and heuristic fallbacks"
```

---

### Task 5: Wire parser into the app, clean up pdfExtract, add German OCR

**Files:**
- Modify: `src/lib/pdfExtract.ts` (delete `parseExpenseFromText`, `ExtractedExpenseData`, `isValidDate`; change OCR languages)
- Modify: `src/pages/ExpensesPage.tsx` (imports at line 35; parse calls ~lines 130–153; form matches ~lines 608–616 and ~651–659)

**Interfaces:**
- Consumes: `parseExpenseFromText(text, knownSuppliers)`, `ExtractedExpenseData` from `src/lib/expenseParse.ts`.
- Produces: working end-to-end flow; no test file changes.

- [ ] **Step 1: Clean up `src/lib/pdfExtract.ts`**

1. Delete the entire `parseExpenseFromText` function, the `ExtractedExpenseData` interface, and the `isValidDate` function (everything from `export interface ExtractedExpenseData` to the end of the file).
2. Change the OCR worker languages:

```ts
    ocrWorker = await createWorker("fra+deu+eng");
```

(was `createWorker("fra+eng")`).

- [ ] **Step 2: Update `src/pages/ExpensesPage.tsx`**

Replace the import (line 35):

```ts
import { extractPdfText, extractImageText, isOcrWorkerReady } from "../lib/pdfExtract";
import { parseExpenseFromText, type ExtractedExpenseData } from "../lib/expenseParse";
```

In `handleDroppedFile` (~lines 130–153), pass known supplier names into the parser and make the post-parse match trim/case-insensitive:

```ts
      let extracted: ExtractedExpenseData = {};
      const supplierNames = (pastSuppliers ?? []).map((s) => s.supplier);

      if (ext === "pdf") {
        const text = await extractPdfText(filePath);
        if (text) {
          extracted = parseExpenseFromText(text, supplierNames);
        }
      } else if (["png", "jpg", "jpeg", "heic"].includes(ext)) {
        if (!isOcrWorkerReady()) setOcrFirstRun(true);
        const text = await extractImageText(filePath);
        if (text) {
          extracted = parseExpenseFromText(text, supplierNames);
        }
      }

      // Match supplier to known suppliers for category autofill
      if (extracted.supplier && pastSuppliers) {
        const needle = extracted.supplier.trim().toLowerCase();
        const match = pastSuppliers.find(
          (s) => s.supplier.trim().toLowerCase() === needle
        );
        if (match) {
          extracted.supplier = match.supplier;
        }
      }
```

In the form component, make both prefill matches (the `useState` initializer ~lines 608–616 and the `useEffect` ~lines 651–659) trim/case-insensitive. In both places replace:

```ts
      const match = pastSuppliers.find(
        (s) => s.supplier.toLowerCase() === prefill.supplier!.toLowerCase()
      );
```

with:

```ts
      const match = pastSuppliers.find(
        (s) => s.supplier.trim().toLowerCase() === prefill.supplier!.trim().toLowerCase()
      );
```

(The `useState` initializer uses `prefill?.supplier` — keep its optional chaining as-is and only change the comparison.)

- [ ] **Step 3: Verify — full test suite, lint, build**

Run from repo root:

```bash
npm test && npm run lint && npm run build
```

Expected: all tests pass, no new lint errors, `tsc` build succeeds (proves no dangling references to the removed exports in `pdfExtract.ts`).

- [ ] **Step 4: Manual smoke test (user-assisted)**

Ask the user to run `npm run tauri dev`, drop a real PDF invoice and a photo receipt onto the Expenses page, and confirm supplier/amount/dates prefill correctly. First image after this change re-downloads OCR language data (~15MB, one time) because `deu` was added.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdfExtract.ts src/pages/ExpensesPage.tsx
git commit -m "feat: wire scoring-based expense parser into Expenses page, add German OCR"
```
