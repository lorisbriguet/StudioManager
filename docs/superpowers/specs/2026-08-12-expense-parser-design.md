# Expense Text Parser Redesign

**Date:** 2026-08-12
**Status:** Approved

## Problem

Expense extraction (`parseExpenseFromText` in `src/lib/pdfExtract.ts`) frequently
produces wrong amounts, wrong dates, and wrong supplier names. Root causes:

- **Amount:** first regex match wins, so subtotals, pre-VAT ("HT") amounts, or
  line items beat the real total. Number normalization breaks on `1,234.56`
  (only the first comma is replaced), `1.234,56` (DE) and `1 234,56` (FR).
- **Dates:** "earliest = invoice, latest = due" is corrupted by any stray date
  (delivery periods, "valid until", terms). Labels near dates are ignored.
- **Supplier:** "first plausible line" heuristic is unreliable on letterheads
  and OCR noise. The existing supplier history in the DB is only used for
  exact-match category autofill after the fact.
- **OCR:** Tesseract loads `fra+eng` only, so German receipts OCR badly.

Documents are regular supplier invoices and shop/card receipts in mixed
FR/DE/EN. Everything must stay local — no cloud APIs.

## Approach

Replace first-match-wins regexes with candidate collection + scoring, in a new
pure module. Chosen over a local LLM (heavy install, slow, non-deterministic)
and macOS NSDataDetector (dates only).

## Design

### Structure

- New pure module `src/lib/expenseParse.ts` — no Tauri imports, unit-testable.
  Exports `parseExpenseFromText(text: string, knownSuppliers?: string[])` and
  the `ExtractedExpenseData` type.
- `src/lib/pdfExtract.ts` keeps extraction plumbing only (PDFKit JXA, Tesseract
  worker, HEIC conversion). Parsing code and `ExtractedExpenseData` move out.
- `src/pages/ExpensesPage.tsx` imports the parser from the new module and
  passes past supplier names in.
- Tests in `src/lib/__tests__/expenseParse.test.ts` (vitest, already set up).

### Amount detection

- `parseAmount(raw: string): number | null` handles `1'234.56` (CH),
  `1.234,56` (DE), `1 234,56` (FR), `1,234.56` (EN). Rule: a final separator
  group of 1–2 digits is the decimal part; all other separators are thousands.
- Scan every line for money tokens; build candidates
  `{ value, lineText, lineIndex }`.
- Score per candidate from same-line keywords:
  - Positive: `total ttc`, `gesamtbetrag`, `montant dû`, `à payer`,
    `zu zahlen`, `amount due`, `summe`, `total`, `montant`, `betrag`.
  - Negative: `sous-total`, `subtotal`, `zwischensumme`, `ht`, `hors taxe`,
    `tva`, `mwst`, `vat`, `rabais`, `discount`.
  - Small bonus for bottom half of the document.
  - Tie-break: largest value.
- Validation unchanged: `0 < x < 1_000_000`, rounded to 2 decimals.

### Date detection

- Collect all dates with line context. Patterns: `dd.mm.yyyy`, ISO
  `yyyy-mm-dd`, plus `dd.mm.yy` (two-digit years on till receipts, expanded
  to 20xx).
- Invoice date: date on a line matching `date de facture`, `rechnungsdatum`,
  `invoice date`, `datum`, `date:`, `facture du`.
- Due date: date on a line matching `échéance`, `payable jusqu'au`,
  `zahlbar bis`, `fällig`, `due date`, `payment due`.
- Fallback (no labeled match): earliest = invoice, latest = due, considering
  only dates within ~1 year of each other to exclude outliers like
  "valid until 2030".
- Validity window unchanged (2020–2030).

### Supplier detection

Priority order:

1. **Fuzzy match against known suppliers** (names passed by caller from the
   `pastSuppliers` query): normalized (case, whitespace, punctuation)
   substring and token-overlap matching between document text and each known
   name — e.g. "Migros" in the text matches past supplier "Migros SA".
   Returns the canonical DB name so category/amount autofill fires.
2. Existing labeled patterns (`fournisseur:`, `supplier:`, …).
3. Existing first-lines heuristic as final fallback.

`ExpensesPage.tsx` keeps its post-parse exact match for autofill but makes it
case/whitespace-insensitive.

### OCR language

Tesseract worker: `"fra+eng"` → `"fra+deu+eng"` (~15MB one-time download,
cached afterwards).

### Testing

TDD with vitest. Fixture texts per document type:

- FR invoice with TVA/sous-total lines
- DE invoice with MwSt and `1.234,56` formatting
- EN receipt with `1,234.56` formatting
- Swiss invoice with apostrophe thousands
- Multi-date invoice (invoice + due + delivery dates)
- Till receipt with two-digit year
- Known-supplier match (fuzzy) case

Unit tests per function (`parseAmount`, date extraction, supplier match) plus
end-to-end `parseExpenseFromText` assertions on all fields.

## Error handling

Unchanged: parser returns partial data (fields undefined when not found);
`ExpensesPage` already falls back to a blank prefilled form on failure.

## Out of scope (YAGNI)

- Confidence scores / uncertainty UI
- Image OCR quality tuning beyond the language pack
- Non-macOS support
- Swiss QR-bill structured decoding
