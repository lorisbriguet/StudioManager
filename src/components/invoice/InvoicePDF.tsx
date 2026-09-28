import { Text, View } from "@react-pdf/renderer";
import { invoiceLabels, type InvoiceLanguage } from "../../i18n/invoice-labels";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import type { Client, ClientAddress } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";
import type { InvoiceTemplate } from "../../types/invoice-template";
import { formatDisplayDate } from "../../utils/formatDate";
import { createDocumentStyles } from "../pdf/documentStyles";
import { PdfDocumentLayout } from "../pdf/PdfDocumentLayout";
import { QRBillCanvas } from "./QRBillSvgRenderer";
import { buildQRBillData, shouldRenderQrBill } from "./qr-bill";

interface InvoicePDFProps {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  client: Client;
  profile: BusinessProfile;
  contactName?: string;
  billingAddress?: ClientAddress | null;
  projectName?: string;
  /** When > 0, renders a "REMINDER" header with the count */
  reminderCount?: number;
  template?: InvoiceTemplate;
}

function formatAmount(amount: number, currency = "CHF"): string {
  return `${currency} ${amount.toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function InvoicePDF({
  invoice,
  lineItems,
  client,
  profile,
  contactName,
  billingAddress,
  projectName,
  reminderCount = 0,
  template,
}: InvoicePDFProps) {
  const lang = (invoice.language as InvoiceLanguage) || "FR";
  const t = invoiceLabels[lang];
  const styles = createDocumentStyles(template);

  // Invoice-only template flags — the quote has no PO number or QR bill.
  const showPoNumber = template ? !!template.show_po_number : true;
  const showQrBill = template ? !!template.show_qr_bill : true;

  const qrBillData = shouldRenderQrBill(invoice, profile, showQrBill) ? buildQRBillData(invoice, client, profile) : null;
  const qrBillLang = invoice.language === "EN" ? "EN" as const : "FR" as const;

  const cur = invoice.currency || "CHF";
  const fmt = (amount: number) => formatAmount(amount, cur);
  const paymentDays = invoice.payment_terms_days || profile.default_payment_terms_days || 30;
  const paymentTermsText = t.net_days.replace("{days}", String(paymentDays));

  const metaRows = [
    { label: t.invoice_date, value: formatDisplayDate(invoice.invoice_date) },
    { label: t.due_date, value: invoice.due_date ? formatDisplayDate(invoice.due_date) : "" },
    { label: t.reference, value: invoice.reference.startsWith("DRAFT") ? "Draft" : invoice.reference },
  ];

  const extraMetaRows = showPoNumber && invoice.po_number ? (
    <>
      <View style={{ height: 6 }} />
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>{t.po_number}</Text>
        <Text style={styles.metaValue}>{invoice.po_number}</Text>
      </View>
    </>
  ) : undefined;

  const banner = reminderCount > 0 ? (
    <View style={styles.reminderBanner}>
      <Text style={styles.reminderText}>
        {t.reminder_nth.replace("{n}", String(reminderCount))}
      </Text>
    </View>
  ) : undefined;

  const footerBlock = (
    <View style={styles.paymentSection}>
      <Text style={styles.paymentTitle}>{t.payment_terms}</Text>
      <Text>{paymentTermsText}</Text>
    </View>
  );

  const fixedFooter = qrBillData ? (
    <View style={styles.qrBill}>
      <QRBillCanvas data={qrBillData} language={qrBillLang} />
    </View>
  ) : undefined;

  return (
    <PdfDocumentLayout
      title={t.invoice_title.toUpperCase()}
      lang={lang}
      labels={t}
      template={template}
      profile={profile}
      client={client}
      billingAddress={billingAddress}
      contactName={contactName}
      metaRows={metaRows}
      activity={invoice.activity}
      assignment={invoice.assignment}
      projectName={projectName}
      extraMetaRows={extraMetaRows}
      lineItems={lineItems}
      formatAmount={fmt}
      subtotal={invoice.subtotal}
      discountApplied={invoice.discount_applied === 1}
      discountRate={invoice.discount_rate}
      total={invoice.total}
      notes={invoice.notes}
      banner={banner}
      footerBlock={footerBlock}
      fixedFooter={fixedFooter}
    />
  );
}
