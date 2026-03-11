import type { Data } from "swissqrbill/types";
import type { Invoice } from "../../types/invoice";
import type { Client } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";

/** Generate a valid 27-digit QR reference from an invoice reference like "2026-001" */
function toQRReference(ref: string): string {
  const digits = ref.replace(/\D/g, "");
  const padded = digits.padStart(26, "0");
  // Mod 10 recursive check digit (Swiss standard)
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (let i = 0; i < padded.length; i++) {
    carry = table[(carry + parseInt(padded[i], 10)) % 10];
  }
  const checkDigit = (10 - carry) % 10;
  return padded + checkDigit;
}

/** Check if IBAN is a QR-IBAN (institution 30000–31999) */
function isQRIBAN(iban: string): boolean {
  const clean = iban.replace(/\s/g, "");
  const iid = parseInt(clean.substring(4, 9), 10);
  return iid >= 30000 && iid <= 31999;
}

/** Build the swissqrbill Data object for an invoice */
export function buildQRBillData(
  invoice: Invoice,
  client: Client,
  profile: BusinessProfile
): Data {
  const account = profile.iban.replace(/\s/g, "");
  const needsQRRef = isQRIBAN(account);

  return {
    creditor: {
      name: profile.owner_name,
      address: profile.address,
      zip: profile.postal_code,
      city: profile.city,
      country: profile.country || "CH",
      account,
    },
    currency: "CHF",
    amount: invoice.total,
    ...(needsQRRef
      ? { reference: toQRReference(invoice.reference) }
      : {}),
    message: invoice.po_number
      ? `${invoice.reference} - ${client.name} - PO ${invoice.po_number}`
      : `${invoice.reference} - ${client.name}`,
    debtor: {
      name: client.name,
      address: client.address_line1 || "",
      zip: (client.postal_city || client.address_line2)?.match(/^\d+/)?.[0] || "",
      city: (client.postal_city || client.address_line2)?.replace(/^\d+\s*/, "") || "",
      country: "CH",
    },
  };
}
