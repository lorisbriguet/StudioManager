import type { ReactNode } from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { invoiceLabels, InvoiceLanguage } from "../../i18n/invoice-labels";
import type { Client, ClientAddress } from "../../types/client";
import type { BusinessProfile } from "../../types/business-profile";
import type { InvoiceTemplate } from "../../types/invoice-template";
import { createDocumentStyles } from "./documentStyles";

interface PdfLineItem {
  designation: string;
  quantity: number;
  rate: number | null;
  unit: string | null;
  amount: number;
}

interface PdfMetaRow {
  label: string;
  value: string;
}

/** `invoiceLabels.FR`/`.EN` widened to `string` values — `t` is a union of
 *  the two literal-typed language objects depending on which one `lang`
 *  picked at the call site, so the narrower per-language type won't do. */
type InvoiceLabels = Record<keyof (typeof invoiceLabels)["FR"], string>;

export interface PdfDocumentLayoutProps {
  title: string;
  /** Drives the "A l'att. de X" (FR) vs "att: X" (EN) contact line. */
  lang: InvoiceLanguage;
  labels: InvoiceLabels;
  template?: InvoiceTemplate;
  profile: BusinessProfile;
  client: Client;
  billingAddress?: ClientAddress | null;
  contactName?: string;
  /** The rows between the two meta spacers — date(s) + reference, already
   *  formatted and DRAFT-cased by the caller (invoice and quote differ here). */
  metaRows: PdfMetaRow[];
  activity?: string;
  assignment?: string;
  projectName?: string;
  /** Invoice-only trailing meta content (the PO-number spacer + row); the
   *  quote has no equivalent field so this stays undefined there. */
  extraMetaRows?: ReactNode;
  lineItems: PdfLineItem[];
  formatAmount: (value: number) => string;
  subtotal: number;
  discountApplied: boolean;
  discountRate: number;
  total: number;
  notes?: string | null;
  /** The invoice reminder header; absent for the quote. */
  banner?: ReactNode;
  /** Payment terms (invoice) or validity (quote). */
  footerBlock: ReactNode;
  /** The QR bill (invoice only). */
  fixedFooter?: ReactNode;
}

/**
 * Shared body of the invoice and quote PDFs: header, meta rows, line-item
 * table (with dynamic column order and global-rate collapsing), notes,
 * totals, bank details, thank-you line and page number. What differs
 * between the two documents comes in as props — see task-10-report.md for
 * how this was derived from the two former components.
 */
export function PdfDocumentLayout({
  title,
  lang,
  labels: t,
  template,
  profile,
  client,
  billingAddress,
  contactName,
  metaRows,
  activity,
  assignment,
  projectName,
  extraMetaRows,
  lineItems,
  formatAmount,
  subtotal,
  discountApplied,
  discountRate,
  total,
  notes,
  banner,
  footerBlock,
  fixedFooter,
}: PdfDocumentLayoutProps) {
  const styles = createDocumentStyles(template);

  // Visibility flags (default to showing everything when no template)
  const showNotes = template ? !!template.show_notes : true;
  const showProjectName = template ? !!template.show_project_name : true;
  const showBankDetails = template ? !!template.show_bank_details : true;
  const showFooter = template ? !!template.show_footer : true;
  // Column order
  const columnOrder: string[] = template?.columns
    ? (() => { try { return JSON.parse(template.columns) as string[]; } catch { return ["designation", "rate", "unit", "qty", "amount"]; } })()
    : ["designation", "rate", "unit", "qty", "amount"];

  // Detect global rate: all items share the same non-null rate and same unit
  const allSameRate = lineItems.length > 0 && lineItems.every((item) => item.rate != null && item.rate === lineItems[0].rate);
  const allSameUnit = lineItems.length > 0 && lineItems.every((item) => item.unit === lineItems[0].unit);
  const isGlobalRate = allSameRate && allSameUnit && lineItems[0].rate != null && lineItems[0].unit;
  const hasRate = !isGlobalRate && lineItems.some((item) => item.rate != null);
  const hasUnit = !isGlobalRate && lineItems.some((item) => item.unit != null && item.unit !== "");

  // Use billing address if provided, otherwise fall back to client defaults
  const addr = billingAddress ?? {
    billing_name: client.billing_name || client.name,
    address_line1: client.address_line1,
    address_line2: client.address_line2,
    postal_city: client.postal_city,
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Content area — flex: 1 fills space above a fixed footer (QR bill) */}
        <View style={styles.content}>
          {banner}

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Header: business info left, client right */}
          <View style={styles.header}>
            <View style={styles.businessInfo}>
              <Text style={styles.businessName}>{profile.owner_name}</Text>
              <Text>
                {profile.address}, {profile.postal_code} {profile.city}
              </Text>
              <Text>{profile.email}</Text>
              <Text>{profile.phone}</Text>
            </View>
            <View style={styles.clientBlock}>
              <Text style={styles.clientName}>{addr.billing_name || client.name}</Text>
              {contactName && (
                <Text>{lang === "FR" ? `A l'att. de ${contactName}` : `att: ${contactName}`}</Text>
              )}
              {addr.address_line1 && <Text>{addr.address_line1}</Text>}
              {addr.address_line2 && <Text>{addr.address_line2}</Text>}
              {addr.postal_city && <Text>{addr.postal_city}</Text>}
            </View>
          </View>

          {/* Meta info */}
          <View style={styles.metaBlock}>
            {profile.ide_number && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{t.ide}</Text>
                <Text style={styles.metaValue}>{profile.ide_number}</Text>
              </View>
            )}
            {profile.affiliate_number && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{t.affiliate_number}</Text>
                <Text style={styles.metaValue}>{profile.affiliate_number}</Text>
              </View>
            )}
            <View style={{ height: 6 }} />
            {metaRows.map((row, i) => (
              <View key={i} style={styles.metaRow}>
                <Text style={styles.metaLabel}>{row.label}</Text>
                <Text style={styles.metaValue}>{row.value}</Text>
              </View>
            ))}
            <View style={{ height: 6 }} />
            {activity && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{t.activity}</Text>
                <Text style={styles.metaValue}>{activity}</Text>
              </View>
            )}
            {assignment && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{t.assignment}</Text>
                <Text style={styles.metaValue}>{assignment}</Text>
              </View>
            )}
            {showProjectName && projectName && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{t.project}</Text>
                <Text style={styles.metaValue}>{projectName}</Text>
              </View>
            )}
            {extraMetaRows}
          </View>

          {/* Line items table */}
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              {columnOrder.map((col) => {
                if (col === "designation") return <Text key={col} style={[styles.thText, styles.colDesignation]}>{t.designation}</Text>;
                if (col === "rate" && hasRate) return <Text key={col} style={[styles.thText, styles.colRate]}>{t.rate}</Text>;
                if (col === "unit" && hasUnit) return <Text key={col} style={[styles.thText, styles.colUnit]}>{t.unit}</Text>;
                if (col === "qty") return <Text key={col} style={[styles.thText, styles.colQty]}>{t.quantity}</Text>;
                if (col === "amount") return <Text key={col} style={[styles.thText, styles.colAmount]}>{t.amount}</Text>;
                return null;
              })}
            </View>
            {lineItems.map((item, i) => (
              <View key={i} style={styles.tableRow}>
                {columnOrder.map((col) => {
                  if (col === "designation") return <Text key={col} style={styles.colDesignation}>{item.designation}</Text>;
                  if (col === "rate" && hasRate) return <Text key={col} style={styles.colRate}>{item.rate != null ? formatAmount(item.rate) : ""}</Text>;
                  if (col === "unit" && hasUnit) return <Text key={col} style={styles.colUnit}>{item.unit || ""}</Text>;
                  if (col === "qty") return <Text key={col} style={styles.colQty}>{item.quantity}</Text>;
                  if (col === "amount") return <Text key={col} style={styles.colAmount}>{formatAmount(item.amount)}</Text>;
                  return null;
                })}
              </View>
            ))}
          </View>

          {/* Global rate label */}
          {isGlobalRate && (
            <Text style={{ fontSize: 8, color: "#666", marginTop: 4, marginBottom: 4 }}>
              {t.all_items_at} {formatAmount(lineItems[0].rate!)} / {(t as Record<string, string>)[`unit_${lineItems[0].unit}`] ?? lineItems[0].unit}
            </Text>
          )}

          {/* Notes */}
          {showNotes && notes ? (
            <View style={styles.notesBlock}>
              <Text style={styles.notesLabel}>{t.notes}</Text>
              <Text style={styles.notesText}>{notes}</Text>
            </View>
          ) : null}

          {/* Totals */}
          <View style={styles.totalsBlock}>
            {profile.vat_exempt === 1 && (
              <Text style={styles.vatNote}>{t.vat_exempt}</Text>
            )}
            {discountApplied && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {t.cultural_discount} ({(discountRate * 100).toFixed(0)}%)
                </Text>
                <Text>
                  - {formatAmount(subtotal * discountRate)}
                </Text>
              </View>
            )}
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>{t.invoice_total.toUpperCase()}</Text>
              <Text style={styles.grandTotalValue}>{formatAmount(total)}</Text>
            </View>
          </View>

          {/* Footer */}
          {showFooter && (
            <View style={styles.footer}>
              <View style={styles.footerRow}>
                {footerBlock}
                {showBankDetails && profile.bank_name && (
                  <View style={styles.bankSection}>
                    <Text style={styles.bankTitle}>{t.bank_details}</Text>
                    <Text>{profile.bank_name}</Text>
                    <Text>IBAN: {profile.iban}</Text>
                    {profile.bic_swift && <Text>{t.bic}: {profile.bic_swift}</Text>}
                  </View>
                )}
                <Text style={styles.thankYou}>{t.thank_you}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Fixed footer — the QR bill, at fixed height at the bottom of the page */}
        {fixedFooter}

        {/* Page numbers — only when multi-page */}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${t.page} ${pageNumber} / ${totalPages}` : ""
          }
          fixed
        />
      </Page>
    </Document>
  );
}
