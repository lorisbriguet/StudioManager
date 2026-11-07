import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { generateAndStoreInvoicePdf } from "../lib/invoicePdfStore";

// The stored PDF is what the preview iframe shows, what "mark as sent &
// export" downloads and what the trustee export copies. It is rendered with
// the same props as the live preview (template, billing address, project
// name), but without a reminder banner: it is the invoice the client first
// got (2-D5).

const captured = vi.hoisted(() => ({ doc: null as { props: Record<string, unknown> } | null }));

vi.mock("@react-pdf/renderer", () => ({
  pdf: (doc: unknown) => {
    captured.doc = doc as { props: Record<string, unknown> };
    return {
      toBlob: async () => new Blob([new Uint8Array([1])], { type: "application/pdf" }),
    };
  },
  StyleSheet: { create: (s: unknown) => s },
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  Canvas: () => null,
}));

// The VOID overlay parses real PDF bytes; the render above is a stub.
vi.mock("../lib/pdfPostProcess", () => ({ postProcessInvoicePdf: async (bytes: Uint8Array) => bytes }));

let invoiceRow: Record<string, unknown> = {
  id: 5,
  reference: "2026-0001",
  client_id: "c1",
  project_id: 7,
  contact_id: null,
  billing_address_id: 2,
  template_id: 3,
  status: "sent",
  reminder_count: 1,
  pdf_path: null,
};

beforeEach(async () => {
  await getDb();
  captured.doc = null;
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM invoice_line_items")) return [];
    if (flat.includes("FROM invoices WHERE id")) return [invoiceRow];
    if (flat.includes("FROM invoice_templates")) return [{ id: 3, name: "Custom" }];
    if (flat.includes("FROM client_addresses")) {
      return [{ id: 2, client_id: "c1", label: "HQ", billing_name: "ACME SA", address_line1: "", address_line2: "", postal_city: "" }];
    }
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME" }];
    if (flat.includes("FROM business_profile")) return [{ id: 1, name: "Studio" }];
    if (flat.includes("FROM projects")) return [{ id: 7, name: "Proj" }];
    return [];
  });
});

afterEach(() => {
  setSelectHandler(null);
});

describe("generateAndStoreInvoicePdf", () => {
  it("renders the stored PDF with template, billing address and project, without the reminder banner", async () => {
    const path = await generateAndStoreInvoicePdf(5);
    expect(path).toContain("2026-0001_ACME.pdf");
    expect(captured.doc).not.toBeNull();
    const props = captured.doc!.props;
    expect(props.template).toMatchObject({ id: 3 });
    expect(props.billingAddress).toMatchObject({ id: 2 });
    expect(props.projectName).toBe("Proj");
    expect(props.reminderCount).toBe(0);
  });

  it("stores a cancelled invoice as a separate _VOID file, so the original stays", async () => {
    const sent = invoiceRow;
    invoiceRow = { ...sent, status: "cancelled" };
    try {
      const path = await generateAndStoreInvoicePdf(5);
      expect(path).toContain("2026-0001_ACME_VOID.pdf");
    } finally {
      invoiceRow = sent;
    }
  });
});
