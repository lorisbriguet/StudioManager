import { describe, it, expect } from "vitest";
import { buildQRBillData } from "../components/invoice/qr-bill";
import type { Invoice } from "../types/invoice";
import type { Client } from "../types/client";
import type { BusinessProfile } from "../types/business-profile";

const baseProfile: BusinessProfile = {
  id: 1,
  owner_name: "Loris Briguet",
  address: "Rue Test 1",
  postal_code: "1950",
  city: "Sion",
  country: "CH",
  email: "test@test.ch",
  phone: "",
  ide_number: "",
  affiliate_number: "",
  bank_name: "PostFinance",
  bank_address: "",
  iban: "CH93 0076 2011 6238 5295 7",         // Regular IBAN (IID 00762)
  qr_iban: "",
  clearing: "",
  bic_swift: "",
  default_activity: "[]",
  vat_exempt: 1,
  default_payment_terms_days: 30,
};

const baseInvoice = {
  id: 1,
  reference: "2026-001",
  total: 1500,
  po_number: "",
} as Invoice;

const baseClient = {
  id: "CLI001",
  name: "Test Client",
  address_line1: "Client Street 1",
  address_line2: "",
  postal_city: "1000 Lausanne",
} as Client;

describe("buildQRBillData", () => {
  it("uses regular IBAN when qr_iban is empty", () => {
    const data = buildQRBillData(baseInvoice, baseClient, baseProfile);
    expect(data.creditor.account).toBe("CH9300762011623852957");
    // Regular IBAN should not generate a QR reference
    expect(data.reference).toBeUndefined();
  });

  it("uses QR-IBAN when provided", () => {
    const profileWithQR = {
      ...baseProfile,
      qr_iban: "CH44 3199 9123 0008 8901 2", // QR-IBAN (IID 31999)
    };
    const data = buildQRBillData(baseInvoice, baseClient, profileWithQR);
    expect(data.creditor.account).toBe("CH4431999123000889012");
    // QR-IBAN should trigger QR reference generation
    expect(data.reference).toBeDefined();
    expect(data.reference).toHaveLength(27);
  });

  it("falls back to regular IBAN when qr_iban is whitespace", () => {
    const profileWithWhitespace = { ...baseProfile, qr_iban: "   " };
    const data = buildQRBillData(baseInvoice, baseClient, profileWithWhitespace);
    expect(data.creditor.account).toBe("CH9300762011623852957");
  });

  it("includes PO number in message when present", () => {
    const invoiceWithPO = { ...baseInvoice, po_number: "PO-2026-42" };
    const data = buildQRBillData(invoiceWithPO, baseClient, baseProfile);
    expect(data.message).toContain("PO PO-2026-42");
  });

  it("sets debtor from client data", () => {
    const data = buildQRBillData(baseInvoice, baseClient, baseProfile);
    expect(data.debtor!.name).toBe("Test Client");
    expect(data.debtor!.zip).toBe("1000");
    expect(data.debtor!.city).toBe("Lausanne");
  });

  it("sets amount and currency", () => {
    const data = buildQRBillData(baseInvoice, baseClient, baseProfile);
    expect(data.amount).toBe(1500);
    expect(data.currency).toBe("CHF");
  });
});
