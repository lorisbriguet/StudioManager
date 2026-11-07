import { describe, it, expect } from "vitest";
import { buildQRBillData, shouldRenderQrBill } from "../components/invoice/qr-bill";
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

  it("takes the debtor from the invoice's billing address when one is chosen", () => {
    const office = {
      id: 7, client_id: "CLI001", label: "Office", billing_name: "Test Client SA",
      address_line1: "Bahnhofstrasse 9", address_line2: "", postal_city: "8001 Zürich",
    };
    const data = buildQRBillData(baseInvoice, baseClient, baseProfile, office);
    expect(data.debtor).toEqual({
      name: "Test Client SA", address: "Bahnhofstrasse 9", zip: "8001", city: "Zürich", country: "CH",
    });
  });

  it("names the debtor like the invoice does: billing name before client name", () => {
    const data = buildQRBillData(baseInvoice, { ...baseClient, billing_name: "Test Client Sàrl" }, baseProfile);
    expect(data.debtor!.name).toBe("Test Client Sàrl");
  });

  it("reads an old client's city from address_line2", () => {
    const old = { ...baseClient, address_line2: "1950 Sion", postal_city: "" };
    const data = buildQRBillData(baseInvoice, old, baseProfile);
    expect(data.debtor).toMatchObject({ zip: "1950", city: "Sion" });
  });

  it("leaves the debtor out when there is no address", () => {
    const none = { ...baseClient, address_line1: "", address_line2: "", postal_city: "" };
    expect(buildQRBillData(baseInvoice, none, baseProfile).debtor).toBeUndefined();
  });

  it("sets amount and currency", () => {
    const data = buildQRBillData(baseInvoice, baseClient, baseProfile);
    expect(data.amount).toBe(1500);
    expect(data.currency).toBe("CHF");
  });
});

describe("shouldRenderQrBill", () => {
  it("returns true for a CHF invoice with IBAN and toggle on", () => {
    expect(shouldRenderQrBill({ currency: "CHF", reference: "2026-001" }, baseProfile, true)).toBe(true);
  });

  it("returns false for EUR, USD and GBP even with IBAN and toggle on", () => {
    expect(shouldRenderQrBill({ currency: "EUR", reference: "2026-001" }, baseProfile, true)).toBe(false);
    expect(shouldRenderQrBill({ currency: "USD", reference: "2026-001" }, baseProfile, true)).toBe(false);
    expect(shouldRenderQrBill({ currency: "GBP", reference: "2026-001" }, baseProfile, true)).toBe(false);
  });

  it("returns false when IBAN is missing", () => {
    expect(shouldRenderQrBill({ currency: "CHF", reference: "2026-001" }, { ...baseProfile, iban: "" }, true)).toBe(false);
  });

  it("returns false when the template toggle is off", () => {
    expect(shouldRenderQrBill({ currency: "CHF", reference: "2026-001" }, baseProfile, false)).toBe(false);
  });

  it("treats a missing currency as CHF (display default)", () => {
    expect(shouldRenderQrBill({ currency: "", reference: "2026-001" }, baseProfile, true)).toBe(true);
  });

  it("keeps the bill on a draft paid to a normal IBAN", () => {
    expect(shouldRenderQrBill({ currency: "CHF", reference: "DRAFT-abc" }, baseProfile, true)).toBe(true);
  });

  it("leaves the bill out of a draft paid to a QR-IBAN (no QR reference yet)", () => {
    const qrProfile = { ...baseProfile, qr_iban: "CH44 3199 9123 0008 8901 2" };
    expect(shouldRenderQrBill({ currency: "CHF", reference: "DRAFT-abc" }, qrProfile, true)).toBe(false);
    expect(shouldRenderQrBill({ currency: "CHF", reference: "2026-001" }, qrProfile, true)).toBe(true);
  });
});

describe("QR bill message", () => {
  it("leaves a draft's internal reference out of the additional information", () => {
    const draft = { ...baseInvoice, reference: "DRAFT-b934d09d-ff7e" } as Invoice;
    expect(buildQRBillData(draft, baseClient, baseProfile).message).toBe("Test Client");
    const withPo = { ...draft, po_number: "PO-7" } as Invoice;
    expect(buildQRBillData(withPo, baseClient, baseProfile).message).toBe("Test Client - PO PO-7");
  });

  it("keeps the reference for an issued invoice", () => {
    expect(buildQRBillData(baseInvoice, baseClient, baseProfile).message).toBe("2026-001 - Test Client");
  });
});
