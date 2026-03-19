import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { invoiceLabels, type InvoiceLanguage } from "../../i18n/invoice-labels";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import type { Client } from "../../types/client";
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
  // ── QR bill ──
  qrBill: {
    width: "100%",
    height: QR_BILL_HEIGHT,
  },
});

function formatCHF(amount: number): string {
  return `CHF ${amount.toLocaleString("de-CH", {
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
}: InvoicePDFProps) {
  const lang = (invoice.language as InvoiceLanguage) || "FR";
  const t = invoiceLabels[lang];
  const qrBillData = profile.iban ? buildQRBillData(invoice, client, profile) : null;
  const qrBillLang = invoice.language === "EN" ? "EN" as const : "FR" as const;
  const hasRate = lineItems.some((item) => item.rate != null);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Content area — flex: 1 fills space above QR bill */}
        <View style={s.content}>
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
              {contactName && <Text>{contactName}</Text>}
              <Text style={s.clientName}>{client.name}</Text>
              {client.address_line1 && <Text>{client.address_line1}</Text>}
              {client.address_line2 && <Text>{client.address_line2}</Text>}
              {client.postal_city && <Text>{client.postal_city}</Text>}
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
              <Text style={s.metaValue}>{invoice.reference}</Text>
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
              <Text style={[s.thText, s.colQty]}>{t.quantity}</Text>
              <Text style={[s.thText, s.colAmount]}>{t.amount}</Text>
            </View>
            {lineItems.map((item, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={s.colDesignation}>{item.designation}</Text>
                {hasRate && (
                  <Text style={s.colRate}>
                    {item.rate != null ? formatCHF(item.rate) : ""}
                  </Text>
                )}
                <Text style={s.colQty}>{item.quantity}</Text>
                <Text style={s.colAmount}>{formatCHF(item.amount)}</Text>
              </View>
            ))}
          </View>

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
                  - {formatCHF(invoice.subtotal * invoice.discount_rate)}
                </Text>
              </View>
            )}
            <View style={s.grandTotalRow}>
              <Text style={s.grandTotalLabel}>{t.invoice_total.toUpperCase()}</Text>
              <Text style={s.grandTotalValue}>{formatCHF(invoice.total)}</Text>
            </View>
          </View>

          {/* Footer */}
          <View style={s.footer}>
            <View style={s.footerRow}>
              <View style={s.paymentSection}>
                <Text style={s.paymentTitle}>{t.payment_terms}</Text>
                <Text>{t.net_30}</Text>
              </View>
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
      </Page>
    </Document>
  );
}
