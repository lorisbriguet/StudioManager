import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { QuotePDF } from "../components/quote/QuotePDF";
import { getInvoice, getInvoiceLineItems } from "../db/queries/invoices";
import { getQuote, getQuoteLineItems } from "../db/queries/quotes";
import { getClient, getClientContact, getClientAddresses } from "../db/queries/clients";
import { getBusinessProfile } from "../db/queries/business-profile";
import { getInvoiceTemplate } from "../db/queries/invoiceTemplates";
import { getProject } from "../db/queries/projects";
import { postProcessInvoicePdf } from "./pdfPostProcess";
import type { Invoice } from "../types/invoice";
import type { Quote } from "../types/quote";
import type { Client } from "../types/client";

/**
 * The one place invoice and quote PDFs are rendered outside the live preview.
 * Every export (list download, email, bulk export, trustee export, stored
 * PDF) goes through these, so they all get the same props as the preview:
 * template, contact, billing address, project and, for invoices, the VOID
 * overlay on cancelled ones.
 */

export interface BuiltInvoicePdf {
  bytes: Uint8Array<ArrayBuffer>;
  invoice: Invoice;
  client: Client;
  reference: string;
}

export interface BuiltQuotePdf {
  bytes: Uint8Array<ArrayBuffer>;
  quote: Quote;
  client: Client;
  /** Filename-safe reference: drafts collapse to "DRAFT". */
  reference: string;
}

async function renderToBytes(doc: ReturnType<typeof createElement>): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await pdf(doc as never).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

/** Returns null when the invoice, its client or the business profile is missing. */
export async function buildInvoicePdf(invoiceId: number): Promise<BuiltInvoicePdf | null> {
  const [invoice, lineItems, profile] = await Promise.all([
    getInvoice(invoiceId),
    getInvoiceLineItems(invoiceId),
    getBusinessProfile(),
  ]);
  if (!invoice || !profile) return null;
  const client = await getClient(invoice.client_id);
  if (!client) return null;

  const [contact, addresses, project, template] = await Promise.all([
    invoice.contact_id ? getClientContact(invoice.contact_id) : Promise.resolve(null),
    invoice.billing_address_id ? getClientAddresses(invoice.client_id) : Promise.resolve([]),
    invoice.project_id ? getProject(invoice.project_id) : Promise.resolve(null),
    invoice.template_id ? getInvoiceTemplate(invoice.template_id) : Promise.resolve(null),
  ]);
  const contactName = contact ? `${contact.first_name} ${contact.last_name}`.trim() : undefined;
  const billingAddress = addresses.find((a) => a.id === invoice.billing_address_id) ?? null;

  const raw = await renderToBytes(
    createElement(InvoicePDF, {
      invoice,
      lineItems,
      client,
      profile,
      contactName,
      billingAddress,
      projectName: project?.name,
      reminderCount: invoice.reminder_count,
      template: template ?? undefined,
    })
  );
  const bytes = new Uint8Array(
    await postProcessInvoicePdf(raw, { isCancelled: invoice.status === "cancelled" })
  );
  return { bytes, invoice, client, reference: invoice.reference };
}

/** Returns null when the quote, its client or the business profile is missing. */
export async function buildQuotePdf(quoteId: number): Promise<BuiltQuotePdf | null> {
  const [quote, lineItems, profile] = await Promise.all([
    getQuote(quoteId),
    getQuoteLineItems(quoteId),
    getBusinessProfile(),
  ]);
  if (!quote || !profile) return null;
  const client = await getClient(quote.client_id);
  if (!client) return null;

  const [addresses, project, template] = await Promise.all([
    quote.billing_address_id ? getClientAddresses(quote.client_id) : Promise.resolve([]),
    quote.project_id ? getProject(quote.project_id) : Promise.resolve(null),
    quote.template_id ? getInvoiceTemplate(quote.template_id) : Promise.resolve(null),
  ]);
  const billingAddress = addresses.find((a) => a.id === quote.billing_address_id) ?? null;

  const bytes = await renderToBytes(
    createElement(QuotePDF, {
      quote,
      lineItems,
      client,
      profile,
      billingAddress,
      projectName: project?.name,
      template: template ?? undefined,
    })
  );
  const reference = quote.reference.startsWith("DRAFT") ? "DRAFT" : quote.reference;
  return { bytes, quote, client, reference };
}
