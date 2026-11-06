import type { BusinessProfile } from "../../types/business-profile";
import type { Client } from "../../types/client";

/**
 * Sample data for the template editor's live preview. The sender is the
 * owner's own business profile; these values only fill what it leaves empty
 * (a new install, or no bank details yet, so the QR slip still shows).
 */

export const sampleInvoice = {
  id: 0,
  reference: "INV-2026-001",
  invoice_date: "2026-01-15",
  due_date: "2026-02-14",
  status: "sent" as const,
  total: 3500,
  subtotal: 3500,
  currency: "CHF",
  notes: "Thank you for your business.",
  activity: "Graphic Design",
  assignment: "Brand Identity",
  po_number: "PO-12345",
  project_id: null,
  client_id: 0,
  contact_id: null,
  billing_address_id: null,
  language: "EN" as const,
  discount_rate: 0,
  discount_amount: 0,
  exchange_rate: null,
  chf_equivalent: null,
  chf_manual_override: null,
  pdf_path: null,
  payment_terms_days: 30,
  reminder_count: 0,
  last_reminder_date: null,
  template_id: null,
  created_at: "",
  updated_at: "",
};

export const sampleLineItems = [
  { id: 1, invoice_id: 0, designation: "Logo Design", quantity: 1, rate: 1500, unit: "flat rate", amount: 1500, sort_order: 0 },
  { id: 2, invoice_id: 0, designation: "Brand Guidelines", quantity: 8, rate: 150, unit: "hours", amount: 1200, sort_order: 1 },
  { id: 3, invoice_id: 0, designation: "Business Card Design", quantity: 1, rate: 800, unit: "flat rate", amount: 800, sort_order: 2 },
];

export const sampleClient: Client = {
  id: "C-000",
  name: "Acme Corp",
  billing_name: "",
  address_line1: "Bahnhofstrasse 1",
  address_line2: "",
  postal_city: "8001 Zurich",
  email: "hello@acme.ch",
  phone: "",
  language: "EN",
  has_discount: 0,
  discount_rate: 0,
  notes: "",
  created_at: "",
  updated_at: "",
};

/** Placeholder sender. Country is a two-letter code: the QR slip refuses anything else. */
export const sampleProfile: BusinessProfile = {
  id: 1,
  owner_name: "Your Name",
  address: "Rue du Marché 1",
  postal_code: "1000",
  city: "Lausanne",
  country: "CH",
  email: "hello@example.ch",
  phone: "+41 79 000 00 00",
  ide_number: "CHE-123.456.789",
  affiliate_number: "",
  bank_name: "UBS Switzerland AG",
  bank_address: "Bahnhofstrasse 45, 8001 Zurich",
  iban: "CH56 0483 5012 3456 7800 9",
  qr_iban: "",
  clearing: "8300",
  bic_swift: "UBSWCHZH80A",
  default_activity: '["Graphic Design"]',
  default_payment_terms_days: 30,
  vat_exempt: 1,
};

/** The profile the preview prints: the owner's own, the sample filling only its empty fields. */
export function templatePreviewProfile(profile: BusinessProfile | null | undefined): BusinessProfile {
  if (!profile) return sampleProfile;
  const merged = { ...sampleProfile } as Record<string, unknown>;
  for (const [key, value] of Object.entries(profile)) {
    if (value !== null && value !== undefined && value !== "") merged[key] = value;
  }
  // A QR-IBAN only makes sense with the owner's own IBAN, never the sample's.
  if (!profile.iban) merged.qr_iban = "";
  return merged as unknown as BusinessProfile;
}
