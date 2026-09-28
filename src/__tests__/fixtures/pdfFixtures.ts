/**
 * Shared fixtures for the invoice/quote PDF golden snapshots
 * (see `pdfGolden.test.tsx`) and for Task 10's extraction proof.
 *
 * All data below is fictional: no real person, company, address, or IBAN.
 * The IBAN is the published Swiss example IBAN CH93 0076 2011 6238 5295 7.
 * Dates are literal strings — never `new Date()` — so the snapshots never
 * drift with the clock.
 */
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import type { Quote, QuoteLineItem } from "../../types/quote";
import type { Client } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";
import type { InvoiceTemplate } from "../../types/invoice-template";

export const clientFixture: Client = {
  id: "client-1",
  name: "Atelier Verriere",
  billing_name: "Atelier Verriere Sarl",
  address_line1: "Rue des Alpes 12",
  address_line2: "Case postale 45",
  postal_city: "1004 Lausanne",
  email: "info@atelier-verriere.example",
  phone: "+41 21 555 00 12",
  language: "FR",
  has_discount: 1,
  discount_rate: 0.1,
  notes: "",
  created_at: "2026-01-05 09:00:00",
  updated_at: "2026-01-05 09:00:00",
};

export const profileFixture: BusinessProfile = {
  id: 1,
  owner_name: "Sacha Delacroix",
  address: "Chemin des Cerisiers 4",
  postal_code: "1201",
  city: "Geneve",
  country: "CH",
  email: "hello@delacroix-design.example",
  phone: "+41 22 555 03 20",
  ide_number: "CHE-123.456.789",
  affiliate_number: "038.1234.5",
  bank_name: "Banque Cantonale Fictive",
  bank_address: "Place Bancaire 1, 1200 Geneve",
  iban: "CH93 0076 2011 6238 5295 7",
  qr_iban: "",
  clearing: "0076",
  bic_swift: "POFICHBEXXX",
  default_activity: JSON.stringify(["Graphisme", "Direction artistique"]),
  vat_exempt: 0,
  default_payment_terms_days: 30,
};

export const templateFixture: InvoiceTemplate = {
  id: 1,
  name: "Default",
  is_default: 1,
  accent_color: "#1a1a1a",
  font_family: "Helvetica",
  logo_position: "left",
  margins_top: 35,
  margins_right: 50,
  margins_bottom: 40,
  margins_left: 50,
  show_notes: 1,
  show_project_name: 1,
  show_po_number: 1,
  show_bank_details: 1,
  show_qr_bill: 1,
  show_footer: 1,
  columns: JSON.stringify(["designation", "rate", "unit", "qty", "amount"]),
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
};

export const invoiceFixture: Invoice = {
  id: 42,
  reference: "2026-014",
  client_id: "client-1",
  project_id: 7,
  status: "sent",
  language: "FR",
  activity: "Graphisme",
  activity_id: 3,
  assignment: "Refonte identite visuelle",
  invoice_date: "2026-03-01",
  due_date: "2026-03-31",
  payment_terms_days: 30,
  subtotal: 2450,
  discount_applied: 1,
  discount_rate: 0.1,
  discount_label: "Rabais culturel",
  total: 2205,
  paid_date: null,
  contact_id: null,
  billing_address_id: null,
  currency: "CHF",
  exchange_rate: 1,
  chf_equivalent: 2205,
  po_number: "PO-2026-0088",
  pdf_path: null,
  from_quote_id: null,
  notes: "Merci de regler dans les 30 jours. Facture emise conformement a l'offre du 15 fevrier 2026.",
  reminder_count: 0,
  last_reminder_date: null,
  template_id: 1,
  created_at: "2026-03-01 08:00:00",
  updated_at: "2026-03-01 08:00:00",
};

export const quoteFixture: Quote = {
  id: 17,
  reference: "2026-Q-009",
  client_id: "client-1",
  project_id: 7,
  status: "sent",
  language: "FR",
  activity: "Graphisme",
  activity_id: 3,
  assignment: "Refonte identite visuelle",
  quote_date: "2026-02-10",
  valid_until: "2026-03-12",
  subtotal: 2450,
  discount_applied: 1,
  discount_rate: 0.1,
  total: 2205,
  billing_address_id: null,
  converted_to_invoice_id: null,
  converted_to_project_id: null,
  notes: "Offre valable 30 jours. Un acompte de 30% est demande a la commande.",
  template_id: 1,
  created_at: "2026-02-10 08:00:00",
  updated_at: "2026-02-10 08:00:00",
};

/**
 * Three items with mixed rates and units — hits the per-row rate/unit
 * columns (not the collapsed global-rate path). Typed as the intersection
 * of InvoiceLineItem and QuoteLineItem so the same fixture can back both
 * InvoicePDF and QuotePDF without `as any`.
 */
export const lineItemsFixture: (InvoiceLineItem & QuoteLineItem)[] = [
  {
    id: 1,
    invoice_id: 42,
    quote_id: 17,
    designation: "Direction artistique",
    rate: 120,
    unit: "hours",
    quantity: 8,
    amount: 960,
    sort_order: 0,
  },
  {
    id: 2,
    invoice_id: 42,
    quote_id: 17,
    designation: "Mise en page brochure",
    rate: 95,
    unit: "hours",
    quantity: 12,
    amount: 1140,
    sort_order: 1,
  },
  {
    id: 3,
    invoice_id: 42,
    quote_id: 17,
    designation: "Forfait impression",
    rate: null,
    unit: "flat",
    quantity: 1,
    amount: 350,
    sort_order: 2,
  },
];

/**
 * Every item shares the same rate and unit — exercises the collapsed
 * global-rate table (rate/unit columns hidden, "all items at" summary line).
 */
export const uniformLineItemsFixture: (InvoiceLineItem & QuoteLineItem)[] = [
  {
    id: 4,
    invoice_id: 42,
    quote_id: 17,
    designation: "Consultation strategique",
    rate: 150,
    unit: "hours",
    quantity: 4,
    amount: 600,
    sort_order: 0,
  },
  {
    id: 5,
    invoice_id: 42,
    quote_id: 17,
    designation: "Ateliers de travail",
    rate: 150,
    unit: "hours",
    quantity: 6,
    amount: 900,
    sort_order: 1,
  },
  {
    id: 6,
    invoice_id: 42,
    quote_id: 17,
    designation: "Revue et iterations",
    rate: 150,
    unit: "hours",
    quantity: 3,
    amount: 450,
    sort_order: 2,
  },
];
