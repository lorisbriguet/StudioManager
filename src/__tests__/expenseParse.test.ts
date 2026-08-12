import { describe, it, expect } from "vitest";
import { parseAmount, parseExpenseFromText } from "../lib/expenseParse";

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
