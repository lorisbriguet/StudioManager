/**
 * Every export outside the live preview renders through buildInvoicePdf /
 * buildQuotePdf, so they must pass the same props as the preview: above all
 * the document's template (finding A1: list-page PDFs used to drop it and
 * came out with default colours, logo and layout).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rendered: { component: string; props: Record<string, unknown> }[] = [];

vi.mock("@react-pdf/renderer", () => ({
  pdf: (doc: { type: { name: string }; props: Record<string, unknown> }) => ({
    toBlob: async () => {
      rendered.push({ component: doc.type.name, props: doc.props });
      return new Blob([new Uint8Array([1, 2, 3])]);
    },
  }),
}));
vi.mock("../components/invoice/InvoicePDF", () => ({ InvoicePDF: function InvoicePDF() { return null; } }));
vi.mock("../components/quote/QuotePDF", () => ({ QuotePDF: function QuotePDF() { return null; } }));

const postProcess = vi.fn(async (bytes: Uint8Array, _opts: { isCancelled: boolean }) => bytes);
vi.mock("../lib/pdfPostProcess", () => ({
  postProcessInvoicePdf: (bytes: Uint8Array, opts: { isCancelled: boolean }) => postProcess(bytes, opts),
}));

const template = { id: 7, name: "Studio", primary_color: "#ff0000" };
const client = { id: "c1", name: "ACME" };
const profile = { id: 1, owner_name: "Loris Briguet" };
const address = { id: 3, client_id: "c1", street: "Rue 1" };
const invoice = {
  id: 1,
  reference: "2026-0001",
  client_id: "c1",
  contact_id: 5,
  billing_address_id: 3,
  project_id: 9,
  template_id: 7,
  reminder_count: 1,
  status: "sent",
};
const quote = {
  id: 2,
  reference: "DRAFT-123",
  client_id: "c1",
  billing_address_id: 3,
  project_id: 9,
  template_id: 7,
};

const getInvoice = vi.fn();
const getQuote = vi.fn();
const getInvoiceTemplate = vi.fn(async () => template);

vi.mock("../db/queries/invoices", () => ({
  getInvoice: (id: number) => getInvoice(id),
  getInvoiceLineItems: async () => [],
  updateInvoice: vi.fn(),
}));
vi.mock("../db/queries/quotes", () => ({
  getQuote: (id: number) => getQuote(id),
  getQuoteLineItems: async () => [],
}));
vi.mock("../db/queries/clients", () => ({
  getClient: async () => client,
  getClientContact: async () => ({ id: 5, first_name: "Ada", last_name: "Lovelace" }),
  getClientAddresses: async () => [address],
}));
vi.mock("../db/queries/business-profile", () => ({ getBusinessProfile: async () => profile }));
vi.mock("../db/queries/invoiceTemplates", () => ({
  getInvoiceTemplate: (id: number) => getInvoiceTemplate(id),
}));
vi.mock("../db/queries/projects", () => ({ getProject: async () => ({ id: 9, name: "Rebrand" }) }));

import { buildInvoicePdf, buildQuotePdf } from "../lib/documentPdf";

beforeEach(() => {
  rendered.length = 0;
  postProcess.mockClear();
  getInvoiceTemplate.mockClear();
  getInvoice.mockResolvedValue(invoice);
  getQuote.mockResolvedValue(quote);
});

describe("buildInvoicePdf", () => {
  it("renders with the invoice's template and the preview's props", async () => {
    const built = await buildInvoicePdf(1);
    expect(built?.reference).toBe("2026-0001");
    expect(built?.client).toBe(client);
    expect(getInvoiceTemplate).toHaveBeenCalledWith(7);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].component).toBe("InvoicePDF");
    expect(rendered[0].props).toMatchObject({
      template,
      contactName: "Ada Lovelace",
      billingAddress: address,
      projectName: "Rebrand",
      reminderCount: 1,
    });
    expect(postProcess).toHaveBeenCalledWith(expect.any(Uint8Array), { isCancelled: false });
  });

  it("falls back to the default look when the invoice has no template", async () => {
    getInvoice.mockResolvedValue({ ...invoice, template_id: null });
    await buildInvoicePdf(1);
    expect(getInvoiceTemplate).not.toHaveBeenCalled();
    expect(rendered[0].props.template).toBeUndefined();
  });

  it("stamps cancelled invoices VOID", async () => {
    getInvoice.mockResolvedValue({ ...invoice, status: "cancelled" });
    await buildInvoicePdf(1);
    expect(postProcess).toHaveBeenCalledWith(expect.any(Uint8Array), { isCancelled: true });
  });

  it("returns null for a missing invoice", async () => {
    getInvoice.mockResolvedValue(null);
    expect(await buildInvoicePdf(1)).toBeNull();
  });
});

describe("buildQuotePdf", () => {
  it("renders with the quote's template and collapses draft references", async () => {
    const built = await buildQuotePdf(2);
    expect(built?.reference).toBe("DRAFT");
    expect(getInvoiceTemplate).toHaveBeenCalledWith(7);
    expect(rendered[0].component).toBe("QuotePDF");
    expect(rendered[0].props).toMatchObject({
      template,
      billingAddress: address,
      projectName: "Rebrand",
    });
  });
});

describe("PDF entry points", () => {
  // Only the live preview pages may render the PDF components themselves;
  // every other page must go through lib/documentPdf.
  it("no list or export page renders InvoicePDF or QuotePDF directly", () => {
    const pagesDir = join(__dirname, "..", "pages");
    const allowed = new Set(["InvoicePreviewPage.tsx", "QuotePreviewPage.tsx"]);
    const offenders = readdirSync(pagesDir)
      .filter((f) => f.endsWith(".tsx") && !allowed.has(f))
      .filter((f) =>
        /components\/(invoice\/InvoicePDF|quote\/QuotePDF)"/.test(readFileSync(join(pagesDir, f), "utf8"))
      );
    expect(offenders).toEqual([]);
  });
});
