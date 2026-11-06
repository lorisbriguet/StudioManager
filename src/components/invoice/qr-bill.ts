import type { Data } from "swissqrbill/types";
import type { Invoice } from "../../types/invoice";
import type { Client, ClientAddress } from "../../types/client";
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

/**
 * Whether the invoice PDF should include a Swiss QR-bill payment part.
 * QR-bill payments are CHF-only, so the payment part renders only for CHF
 * invoices with an IBAN configured and the template's show_qr_bill toggle on.
 * A missing currency defaults to CHF, matching the PDF's display behavior.
 */
export function shouldRenderQrBill(
  invoice: Pick<Invoice, "currency">,
  profile: Pick<BusinessProfile, "iban">,
  showQrBill: boolean
): boolean {
  return (invoice.currency || "CHF") === "CHF" && !!profile.iban && showQrBill;
}

/**
 * Build the swissqrbill Data object for an invoice. The debtor ("Payable by")
 * is the address printed on the invoice: its chosen billing address, else the
 * client's own. With no address at all it is left out, so the bill shows the
 * empty box the payer fills in by hand.
 */
export function buildQRBillData(
  invoice: Invoice,
  client: Client,
  profile: BusinessProfile,
  billingAddress?: ClientAddress | null
): Data {
  const addr = billingAddress ?? client;
  // Older clients keep "1000 Lausanne" in address_line2.
  const cityLine = (addr.postal_city || addr.address_line2 || "").trim();
  const hasAddress = !!(addr.address_line1?.trim() || cityLine);
  const qrIban = profile.qr_iban?.replace(/\s/g, "");
  const account = (qrIban || profile.iban).replace(/\s/g, "");
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
    ...(hasAddress
      ? {
          debtor: {
            name: billingAddress?.billing_name || client.billing_name || client.name,
            address: addr.address_line1 || "",
            zip: cityLine.match(/^\d+/)?.[0] || "",
            city: cityLine.replace(/^\d+\s*/, ""),
            country: "CH",
          },
        }
      : {}),
  };
}
