import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { invoiceLabels, type InvoiceLanguage } from "../../i18n/invoice-labels";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import type { Client, ClientAddress } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";
import { formatDisplayDate } from "../../utils/formatDate";
import { QRBillCanvas } from "./QRBillSvgRenderer";
import { buildQRBillData } from "./qr-bill";

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
}

// A4: 595.28 x 841.89pt — QR bill: 210x105mm = 595.28x297.64pt
const QR_BILL_HEIGHT = 297.64;

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a1a",
    flexDirection: "column",
    height: "100%",
  },
  // ── Content area (everything above QR bill) ──
  content: {
    paddingTop: 35,
    paddingHorizontal: 50,
    flex: 1,
  },
  // ── Title ──
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    marginBottom: 10,
  },
  // ── Header: business left, client right ──
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
  // ── Meta info ──
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
  // ── Table ──
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
  // ── Totals ──
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
  // ── Footer ──
  footer: {
    marginTop: 16,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  paymentSection: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  paymentTitle: {
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
  bankSection: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  bankTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginBottom: 2,
  },
  pageNumber: {
    position: "absolute",
    bottom: 12,
    right: 50,
    fontSize: 7,
    color: "#999",
  },
  // ── Reminder banner ──
  reminderBanner: {
    backgroundColor: "#fee2e2",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 2,
  },
  reminderText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#b91c1c",
    textTransform: "uppercase" as const,
    textAlign: "center" as const,
  },
  // ── QR bill ──
  qrBill: {
    width: "100%",
    height: QR_BILL_HEIGHT,
  },
});

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
}: InvoicePDFProps) {
  const lang = (invoice.language as InvoiceLanguage) || "FR";
  const t = invoiceLabels[lang];
  const qrBillData = profile.iban ? buildQRBillData(invoice, client, profile) : null;
  const qrBillLang = invoice.language === "EN" ? "EN" as const : "FR" as const;
  // Detect global rate: all items share the same non-null rate and same unit
  const allSameRate = lineItems.length > 0 && lineItems.every((item) => item.rate != null && item.rate === lineItems[0].rate);
  const allSameUnit = lineItems.length > 0 && lineItems.every((item) => item.unit === lineItems[0].unit);
  const isGlobalRate = allSameRate && allSameUnit && lineItems[0].rate != null && lineItems[0].unit;
  const hasRate = !isGlobalRate && lineItems.some((item) => item.rate != null);
  const hasUnit = !isGlobalRate && lineItems.some((item) => item.unit != null && item.unit !== "");
  const cur = invoice.currency || "CHF";
  const fmt = (amount: number) => formatAmount(amount, cur);
  const paymentDays = invoice.payment_terms_days || profile.default_payment_terms_days || 30;
  const paymentTermsText = t.net_days.replace("{days}", String(paymentDays));

  // Use billing address if provided, otherwise fall back to client defaults
  const addr = billingAddress ?? {
    billing_name: client.billing_name || client.name,
    address_line1: client.address_line1,
    address_line2: client.address_line2,
    postal_city: client.postal_city,
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Content area — flex: 1 fills space above QR bill */}
        <View style={s.content}>
          {/* Reminder banner */}
          {reminderCount > 0 && (
            <View style={s.reminderBanner}>
              <Text style={s.reminderText}>
                {t.reminder_nth.replace("{n}", String(reminderCount))}
              </Text>
            </View>
          )}

          {/* Title */}
          <Text style={s.title}>{t.invoice_title.toUpperCase()}</Text>

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
              <Text style={s.metaLabel}>{t.invoice_date}</Text>
              <Text style={s.metaValue}>{formatDisplayDate(invoice.invoice_date)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>{t.due_date}</Text>
              <Text style={s.metaValue}>{invoice.due_date ? formatDisplayDate(invoice.due_date) : ""}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>{t.reference}</Text>
              <Text style={s.metaValue}>{invoice.reference.startsWith("DRAFT") ? "Draft" : invoice.reference}</Text>
            </View>
            <View style={{ height: 6 }} />
            {invoice.activity && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.activity}</Text>
                <Text style={s.metaValue}>{invoice.activity}</Text>
              </View>
            )}
            {invoice.assignment && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.assignment}</Text>
                <Text style={s.metaValue}>{invoice.assignment}</Text>
              </View>
            )}
            {projectName && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.project}</Text>
                <Text style={s.metaValue}>{projectName}</Text>
              </View>
            )}
            {invoice.po_number && <View style={{ height: 6 }} />}
            {invoice.po_number && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{t.po_number}</Text>
                <Text style={s.metaValue}>{invoice.po_number}</Text>
              </View>
            )}
          </View>

          {/* Line items table */}
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.thText, s.colDesignation]}>{t.designation}</Text>
              {hasRate && <Text style={[s.thText, s.colRate]}>{t.rate}</Text>}
              {hasUnit && <Text style={[s.thText, s.colUnit]}>{t.unit}</Text>}
              <Text style={[s.thText, s.colQty]}>{t.quantity}</Text>
              <Text style={[s.thText, s.colAmount]}>{t.amount}</Text>
            </View>
            {lineItems.map((item, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={s.colDesignation}>{item.designation}</Text>
                {hasRate && (
                  <Text style={s.colRate}>
                    {item.rate != null ? fmt(item.rate) : ""}
                  </Text>
                )}
                {hasUnit && (
                  <Text style={s.colUnit}>{item.unit || ""}</Text>
                )}
                <Text style={s.colQty}>{item.quantity}</Text>
                <Text style={s.colAmount}>{fmt(item.amount)}</Text>
              </View>
            ))}
          </View>

          {/* Global rate label */}
          {isGlobalRate && (
            <Text style={{ fontSize: 8, color: "#666", marginTop: 4, marginBottom: 4 }}>
              {t.all_items_at} {fmt(lineItems[0].rate!)} / {(t as Record<string, string>)[`unit_${lineItems[0].unit}`] ?? lineItems[0].unit}
            </Text>
          )}

          {/* Notes */}
          {invoice.notes ? (
            <View style={s.notesBlock}>
              <Text style={s.notesLabel}>{t.notes}</Text>
              <Text style={s.notesText}>{invoice.notes}</Text>
            </View>
          ) : null}

          {/* Totals */}
          <View style={s.totalsBlock}>
            {profile.vat_exempt === 1 && (
              <Text style={s.vatNote}>{t.vat_exempt}</Text>
            )}
            {invoice.discount_applied === 1 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>
                  {t.cultural_discount} ({(invoice.discount_rate * 100).toFixed(0)}%)
                </Text>
                <Text>
                  - {fmt(invoice.subtotal * invoice.discount_rate)}
                </Text>
              </View>
            )}
            <View style={s.grandTotalRow}>
              <Text style={s.grandTotalLabel}>{t.invoice_total.toUpperCase()}</Text>
              <Text style={s.grandTotalValue}>{fmt(invoice.total)}</Text>
            </View>
          </View>

          {/* Footer */}
          <View style={s.footer}>
            <View style={s.footerRow}>
              <View style={s.paymentSection}>
                <Text style={s.paymentTitle}>{t.payment_terms}</Text>
                <Text>{paymentTermsText}</Text>
              </View>
              {profile.bank_name && (
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
        </View>

        {/* QR-Bill — fixed height at the bottom of the page */}
        {qrBillData && (
          <View style={s.qrBill}>
            <QRBillCanvas data={qrBillData} language={qrBillLang} />
          </View>
        )}

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
