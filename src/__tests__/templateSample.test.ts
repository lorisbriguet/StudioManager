import { describe, it, expect } from "vitest";
import { SwissQRBill } from "swissqrbill/pdf";
import { buildQRBillData } from "../components/invoice/qr-bill";
import { sampleClient, sampleInvoice, sampleProfile, templatePreviewProfile } from "../components/invoice/templateSample";
import type { BusinessProfile } from "../types/business-profile";
import type { Invoice } from "../types/invoice";

const owner: BusinessProfile = {
  ...sampleProfile,
  owner_name: "Aurore Delacroix",
  address: "Rue des Alpes 4",
  postal_code: "1950",
  city: "Sion",
  iban: "",
  qr_iban: "",
};

/** Builds the slip the way the PDF does; throws what swissqrbill refuses. */
const slip = (profile: BusinessProfile) =>
  new SwissQRBill(buildQRBillData(sampleInvoice as unknown as Invoice, sampleClient, profile));

describe("template editor preview", () => {
  it("prints the owner's own profile", () => {
    const p = templatePreviewProfile(owner);
    expect(p.owner_name).toBe("Aurore Delacroix");
    expect(p.city).toBe("Sion");
  });

  it("fills only the empty fields from the sample, so the QR slip still shows", () => {
    const p = templatePreviewProfile(owner);
    expect(p.iban).toBe(sampleProfile.iban);
    expect(p.qr_iban).toBe("");
  });

  it("uses the sample when there is no profile yet", () => {
    expect(templatePreviewProfile(undefined)).toBe(sampleProfile);
  });

  it("builds a QR slip swissqrbill accepts, with and without a profile", () => {
    expect(() => slip(templatePreviewProfile(undefined))).not.toThrow();
    expect(() => slip(templatePreviewProfile(owner))).not.toThrow();
  });
});
