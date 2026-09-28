import { Text, View } from "@react-pdf/renderer";
import { invoiceLabels, type InvoiceLanguage } from "../../i18n/invoice-labels";
import type { Quote, QuoteLineItem } from "../../types/quote";
import type { Client, ClientAddress } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";
import type { InvoiceTemplate } from "../../types/invoice-template";
import { formatDisplayDate } from "../../utils/formatDate";
import { createDocumentStyles } from "../pdf/documentStyles";
import { PdfDocumentLayout } from "../pdf/PdfDocumentLayout";

interface QuotePDFProps {
  quote: Quote;
  lineItems: QuoteLineItem[];
  client: Client;
  profile: BusinessProfile;
  contactName?: string;
  billingAddress?: ClientAddress | null;
  projectName?: string;
  template?: InvoiceTemplate;
}

function formatCHF(amount: number): string {
  return `CHF ${amount.toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function QuotePDF({
  quote,
  lineItems,
  client,
  profile,
  contactName,
  billingAddress,
  projectName,
  template,
}: QuotePDFProps) {
  const lang = (quote.language as InvoiceLanguage) || "FR";
  const t = invoiceLabels[lang];
  const styles = createDocumentStyles(template);

  const metaRows = [
    { label: t.quote_date, value: formatDisplayDate(quote.quote_date) },
    ...(quote.valid_until ? [{ label: t.valid_until, value: formatDisplayDate(quote.valid_until) }] : []),
    { label: t.reference, value: quote.reference.startsWith("DRAFT") ? "DRAFT" : quote.reference },
  ];

  const footerBlock = (
    <View style={styles.validitySection}>
      <Text style={styles.validityTitle}>{t.validity}</Text>
      <Text>{t.valid_30_days}</Text>
    </View>
  );

  return (
    <PdfDocumentLayout
      title={t.quote_title.toUpperCase()}
      lang={lang}
      labels={t}
      template={template}
      profile={profile}
      client={client}
      billingAddress={billingAddress}
      contactName={contactName}
      metaRows={metaRows}
      activity={quote.activity}
      assignment={quote.assignment}
      projectName={projectName}
      lineItems={lineItems}
      formatAmount={formatCHF}
      subtotal={quote.subtotal}
      discountApplied={quote.discount_applied === 1}
      discountRate={quote.discount_rate}
      total={quote.total}
      notes={quote.notes}
      footerBlock={footerBlock}
    />
  );
}
