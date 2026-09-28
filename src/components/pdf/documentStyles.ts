import { StyleSheet } from "@react-pdf/renderer";
import type { InvoiceTemplate } from "../../types/invoice-template";

// A4: 595.28 x 841.89pt — QR bill: 210x105mm = 595.28x297.64pt
const QR_BILL_HEIGHT = 297.64;

/**
 * Style keys shared by the invoice and the quote, verified key-by-key
 * identical between the two documents' former StyleSheet.create blocks: all
 * 37 shared keys were byte-identical in both value and key order, and 0
 * keys shared the same name while differing in value. A handful of keys
 * are read by only one document — reminderBanner/qrBill/paymentSection/
 * paymentTitle by the invoice, validitySection/validityTitle by the quote —
 * kept here anyway since an unused style key costs nothing and this way
 * there is exactly one place documents' styling lives.
 */
const pdfStyles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a1a",
    flexDirection: "column",
    height: "100%",
  },
  // ── Content area (everything above the QR bill, when there is one) ──
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
  // Invoice-only: the payment-terms block of the footer row.
  paymentSection: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  paymentTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginBottom: 2,
  },
  // Quote-only: the validity block of the footer row.
  validitySection: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  validityTitle: {
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
  // ── Reminder banner (invoice-only) ──
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
  // ── QR bill (invoice-only) ──
  qrBill: {
    width: "100%",
    height: QR_BILL_HEIGHT,
  },
});

/**
 * Builds the stylesheet both documents use. Every key here was verified
 * key-by-key identical between the invoice's and the quote's former
 * stylesheets except for the five below, which both documents already
 * computed from `template` with the exact same defaults — that logic moves
 * here unchanged, still merged as `[base, override]` style arrays (matching
 * how react-pdf's `style` prop already accepted arrays in both documents,
 * and required for the golden snapshots: they record the `style` prop
 * verbatim, array or not).
 */
export function createDocumentStyles(template?: InvoiceTemplate) {
  const fontFamily = template?.font_family ?? "Helvetica";
  const accentColor = template?.accent_color ?? "#1a1a1a";
  const paddingTop = template?.margins_top ?? 35;
  const paddingHorizontal = template?.margins_right ?? 50; // use right margin for horizontal

  return {
    ...pdfStyles,
    page: [
      pdfStyles.page,
      { fontFamily, fontSize: 9, color: "#1a1a1a", flexDirection: "column" as const, height: "100%" },
    ],
    content: [pdfStyles.content, { paddingTop, paddingHorizontal, flex: 1 }],
    title: [pdfStyles.title, { color: accentColor }],
    tableHeader: [pdfStyles.tableHeader, { borderBottomColor: accentColor }],
    grandTotalRow: [pdfStyles.grandTotalRow, { borderTopColor: accentColor }],
  };
}

export type DocumentStyles = ReturnType<typeof createDocumentStyles>;
