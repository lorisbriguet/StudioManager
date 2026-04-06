import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { invoiceLabels, type InvoiceLanguage } from "../../i18n/invoice-labels";
import type { Quote, QuoteLineItem } from "../../types/quote";
import type { Client, ClientAddress } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";
import type { InvoiceTemplate } from "../../types/invoice-template";
import { formatDisplayDate } from "../../utils/formatDate";

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

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a1a",
    flexDirection: "column",
    height: "100%",
  },
  content: {
    paddingTop: 35,
    paddingHorizontal: 50,
    flex: 1,
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    marginBottom: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  businessInfo: {
    fontSize: 8,
    lineHeight: 1.4,
  },
  businessName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginBottom: 2,
  },
  clientBlock: {
    textAlign: "right",
    fontSize: 9,
    lineHeight: 1.4,
  },
  clientName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginBottom: 2,
  },
  metaBlock: {
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  metaLabel: {
    width: 100,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  metaValue: {
    fontSize: 9,
  },
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  colDesignation: { flex: 1 },
  colRate: { width: 70, textAlign: "right" },
  colUnit: { width: 50, textAlign: "center" },
  colQty: { width: 50, textAlign: "right" },
  colAmount: { width: 80, textAlign: "right" },
  thText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    textTransform: "uppercase",
  },
  notesBlock: {
    marginTop: 10,
    marginBottom: 4,
  },
  notesLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    marginBottom: 2,
  },
  notesText: {
    fontSize: 8,
    color: "#444",
    lineHeight: 1.4,
  },
  totalsBlock: {
    marginTop: 10,
    alignItems: "flex-end",
  },
  vatNote: {
    fontSize: 7,
    color: "#666",
    fontStyle: "italic",
    marginBottom: 4,
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    width: 200,
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalLabel: {
    color: "#666",
  },
  grandTotalRow: {
    flexDirection: "row",
    width: 200,
    justifyContent: "space-between",
    paddingVertical: 4,
    borderTopWidth: 1.5,
    borderTopColor: "#1a1a1a",
    marginTop: 2,
  },
  grandTotalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  grandTotalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  footer: {
    marginTop: 16,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  validitySection: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  validityTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginBottom: 2,
  },
  bankSection: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  bankTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginBottom: 2,
  },
  thankYou: {
    fontSize: 8,
    color: "#666",
    textAlign: "right",
    alignSelf: "flex-start",
  },
  pageNumber: {
    position: "absolute",
    bottom: 12,
    right: 50,
    fontSize: 7,
    color: "#999",
  },
});

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

  // Template-driven overrides
  const fontFamily = template?.font_family ?? "Helvetica";
  const accentColor = template?.accent_color ?? "#1a1a1a";
  const paddingTop = template?.margins_top ?? 35;
  const paddingHorizontal = template?.margins_right ?? 50;
  // Visibility flags
  const showNotes = template ? !!template.show_notes : true;
  const showProjectName = template ? !!template.show_project_name : true;
  const showBankDetails = template ? !!template.show_bank_details : true;
  const showFooter = template ? !!template.show_footer : true;
  // Column order
  const columnOrder: string[] = template?.columns
    ? (() => { try { return JSON.parse(template.columns) as string[]; } catch { return ["designation", "rate", "unit", "qty", "amount"]; } })()
    : ["designation", "rate", "unit", "qty", "amount"];

  // Dynamic styles
  const dynPage = { fontFamily, fontSize: 9, color: "#1a1a1a", flexDirection: "column" as const, height: "100%" };
  const dynContent = { paddingTop, paddingHorizontal, flex: 1 };
  const dynTitle = { color: accentColor };
  const dynAccentBorder = { borderBottomColor: accentColor };
  const dynGrandTotal = { borderTopColor: accentColor };

  // Detect global rate: all items share the same non-null rate and same unit
  const allSameRate = lineItems.length > 0 && lineItems.every((item) => item.rate != null && item.rate === lineItems[0].rate);
  const allSameUnit = lineItems.length > 0 && lineItems.every((item) => item.unit === lineItems[0].unit);
  const isGlobalRate = allSameRate && allSameUnit && lineItems[0].rate != null && lineItems[0].unit;
  const hasRate = !isGlobalRate && lineItems.some((item) => item.rate != null);
  const hasUnit = !isGlobalRate && lineItems.some((item) => item.unit != null && item.unit !== "");

  const addr = billingAddress ?? {
    billing_name: client.billing_name || client.name,
    address_line1: client.address_line1,
    address_line2: client.address_line2,
    postal_city: client.postal_city,
  };

  return (
    <Document>
      <Page size="A4" style={[s.page, dynPage]}>
        <View style={[s.content, dynContent]}>
          {/* Title */}
          <Text style={[s.title, dynTitle]}>{t.quote_title.toUpperCase()}</Text>

          {/* Header: business info left, client right */}
          <View style={s.header}>
            <View style={s.businessInfo}>
              <Text style={s.businessName}>{profile.owner_name}</Text>
              <Text>
                {profile.address}, {profile.postal_code} {profile.city}
              </Text>
              <Text>{profile.email}</Text>
              <Text>{profile.phone}</Text>
            </View>
            <View style={s.clientBlock}>
              <Text style={s.clientName}>{addr.billing_name || client.name}</Text>
              {contactName && (
                <Text>{lang === "FR" ? `A l'att. de ${contactName}` : `att: ${contactName}`}</Text>
              )}
              {addr.address_line1 && <Text>{addr.address_line1}</Text>}
              {addr.address_line2 && <Text>{addr.address_line2}</Text>}
              {addr.postal_city && <Text>{addr.postal_city}</Text>}
            </View>
          </View>

          {/* Meta info */}
          <View style={s.metaBlock}>
            {profile.ide_number && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.ide}</Text>
                <Text style={s.metaValue}>{profile.ide_number}</Text>
              </View>
            )}
            {profile.affiliate_number && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.affiliate_number}</Text>
                <Text style={s.metaValue}>{profile.affiliate_number}</Text>
              </View>
            )}
            <View style={{ height: 6 }} />
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>{t.quote_date}</Text>
              <Text style={s.metaValue}>{formatDisplayDate(quote.quote_date)}</Text>
            </View>
            {quote.valid_until && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.valid_until}</Text>
                <Text style={s.metaValue}>{formatDisplayDate(quote.valid_until)}</Text>
              </View>
            )}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>{t.reference}</Text>
              <Text style={s.metaValue}>{quote.reference.startsWith("DRAFT") ? "DRAFT" : quote.reference}</Text>
            </View>
            <View style={{ height: 6 }} />
            {quote.activity && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.activity}</Text>
                <Text style={s.metaValue}>{quote.activity}</Text>
              </View>
            )}
            {quote.assignment && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.assignment}</Text>
                <Text style={s.metaValue}>{quote.assignment}</Text>
              </View>
            )}
            {showProjectName && projectName && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.project}</Text>
                <Text style={s.metaValue}>{projectName}</Text>
              </View>
            )}
          </View>

          {/* Line items table */}
          <View style={s.table}>
            <View style={[s.tableHeader, dynAccentBorder]}>
              {columnOrder.map((col) => {
                if (col === "designation") return <Text key={col} style={[s.thText, s.colDesignation]}>{t.designation}</Text>;
                if (col === "rate" && hasRate) return <Text key={col} style={[s.thText, s.colRate]}>{t.rate}</Text>;
                if (col === "unit" && hasUnit) return <Text key={col} style={[s.thText, s.colUnit]}>{t.unit}</Text>;
                if (col === "qty") return <Text key={col} style={[s.thText, s.colQty]}>{t.quantity}</Text>;
                if (col === "amount") return <Text key={col} style={[s.thText, s.colAmount]}>{t.amount}</Text>;
                return null;
              })}
            </View>
            {lineItems.map((item, i) => (
              <View key={i} style={s.tableRow}>
                {columnOrder.map((col) => {
                  if (col === "designation") return <Text key={col} style={s.colDesignation}>{item.designation}</Text>;
                  if (col === "rate" && hasRate) return <Text key={col} style={s.colRate}>{item.rate != null ? formatCHF(item.rate) : ""}</Text>;
                  if (col === "unit" && hasUnit) return <Text key={col} style={s.colUnit}>{item.unit || ""}</Text>;
                  if (col === "qty") return <Text key={col} style={s.colQty}>{item.quantity}</Text>;
                  if (col === "amount") return <Text key={col} style={s.colAmount}>{formatCHF(item.amount)}</Text>;
                  return null;
                })}
              </View>
            ))}
          </View>

          {/* Global rate label */}
          {isGlobalRate && (
            <Text style={{ fontSize: 8, color: "#666", marginTop: 4, marginBottom: 4 }}>
              {t.all_items_at} {formatCHF(lineItems[0].rate!)} / {(t as Record<string, string>)[`unit_${lineItems[0].unit}`] ?? lineItems[0].unit}
            </Text>
          )}

          {/* Notes */}
          {showNotes && quote.notes ? (
            <View style={s.notesBlock}>
              <Text style={s.notesLabel}>{t.notes}</Text>
              <Text style={s.notesText}>{quote.notes}</Text>
            </View>
          ) : null}

          {/* Totals */}
          <View style={s.totalsBlock}>
            {profile.vat_exempt === 1 && (
              <Text style={s.vatNote}>{t.vat_exempt}</Text>
            )}
            {quote.discount_applied === 1 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>
                  {t.cultural_discount} ({(quote.discount_rate * 100).toFixed(0)}%)
                </Text>
                <Text>
                  - {formatCHF(quote.subtotal * quote.discount_rate)}
                </Text>
              </View>
            )}
            <View style={[s.grandTotalRow, dynGrandTotal]}>
              <Text style={s.grandTotalLabel}>{t.invoice_total.toUpperCase()}</Text>
              <Text style={s.grandTotalValue}>{formatCHF(quote.total)}</Text>
            </View>
          </View>

          {/* Footer */}
          {showFooter && (
            <View style={s.footer}>
              <View style={s.footerRow}>
                <View style={s.validitySection}>
                  <Text style={s.validityTitle}>{t.validity}</Text>
                  <Text>{t.valid_30_days}</Text>
                </View>
                {showBankDetails && profile.bank_name && (
                  <View style={s.bankSection}>
                    <Text style={s.bankTitle}>{t.bank_details}</Text>
                    <Text>{profile.bank_name}</Text>
                    <Text>IBAN: {profile.iban}</Text>
                    {profile.bic_swift && <Text>{t.bic}: {profile.bic_swift}</Text>}
                  </View>
                )}
                <Text style={s.thankYou}>{t.thank_you}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Page numbers — only when multi-page */}
        <Text
          style={s.pageNumber}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${t.page} ${pageNumber} / ${totalPages}` : ""
          }
          fixed
        />
      </Page>
    </Document>
  );
}
