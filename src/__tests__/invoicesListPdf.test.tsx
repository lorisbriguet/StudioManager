import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { InvoicesListPDF } from "../components/finance/InvoicesListPDF";
import type { Invoice } from "../types/invoice";
import type { BusinessProfile } from "../types/business-profile";

// 2-D6: the trustee's invoice list shows each invoice in its own currency,
// adds them up in CHF by the P&L's rule, leaves cancelled ones out of the
// totals and prints statuses in the export language.

/** Every string the PDF tree prints, in order. */
function texts(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  // The tree is made of react-pdf primitives only: walk their children.
  if (isValidElement(node)) return texts((node.props as { children?: ReactNode }).children);
  return [];
}

/** Every printed string, joined by "|". */
function lines(node: ReactNode): string {
  return texts(node).join("|");
}

const inv = (over: Partial<Invoice>): Invoice => ({
  id: 1, reference: "2026-001", client_id: "c1", project_id: null, status: "paid", language: "FR",
  activity: "", activity_id: null, assignment: "", invoice_date: "2026-03-01", due_date: "2026-03-31",
  payment_terms_days: 30, subtotal: 0, discount_applied: 0, discount_rate: 0, discount_label: "",
  total: 1000, paid_date: null, contact_id: null, billing_address_id: null, currency: "CHF",
  exchange_rate: 1, chf_equivalent: 1000, po_number: null, pdf_path: null, from_quote_id: null,
  notes: "", reminder_count: 0, last_reminder_date: null, template_id: null,
  created_at: "", updated_at: "",
  ...over,
} as Invoice);

const profile = { owner_name: "Studio", address: "", postal_code: "", city: "" } as BusinessProfile;

describe("InvoicesListPDF", () => {
  const invoices = [
    inv({ id: 1, reference: "2026-001", total: 1000, currency: "CHF", chf_equivalent: 1000, status: "paid" }),
    inv({ id: 2, reference: "2026-002", total: 1000, currency: "EUR", exchange_rate: 0.8, chf_equivalent: 1250, status: "sent" }),
    inv({ id: 3, reference: "2026-003", total: 500, currency: "CHF", chf_equivalent: 500, status: "cancelled" }),
  ];
  const out = lines(InvoicesListPDF({ year: 2026, invoices, clientNames: { c1: "ACME" }, profile, lang: "FR" }));

  it("prints a foreign invoice in its currency with its CHF equivalent", () => {
    expect(out).toMatch(/EUR\s?1.000\.00/);
    expect(out).toMatch(/CHF\s?1.250\.00/);
  });

  it("totals in CHF without cancelled invoices: 1000 + 1250", () => {
    expect(out).toMatch(/Total\|CHF\s?2.250\.00/);
    expect(out).toMatch(/Encaisse\|CHF\s?1.000\.00/);
    expect(out).toContain("Les factures annulees sont listees mais pas comptees dans les totaux.");
  });

  it("prints statuses in the export language", () => {
    expect(out).toContain("Payee");
    expect(out).toContain("Envoyee");
    expect(out).toContain("Annulee");
    expect(out).not.toMatch(/\|paid\||\|sent\||\|cancelled\|/);
  });

  it("names an invoice paid before it was numbered as a draft, not DRAFT-<uuid>", () => {
    const legacy = inv({ id: 4, reference: "DRAFT-1234-abcd", status: "paid" });
    const text = lines(InvoicesListPDF({ year: 2026, invoices: [legacy], clientNames: {}, profile, lang: "EN" }));
    expect(text).not.toContain("DRAFT-1234");
    expect(text).toContain("Draft");
  });
});
