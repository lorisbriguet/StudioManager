import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Invoice } from "../../types/invoice";
import type { BusinessProfile } from "../../types/business-profile";
import type { AppLanguage } from "../../i18n/ui";
import { getExportLabels } from "../../i18n/export-labels";

export interface Props {
  year: number;
  invoices: Invoice[];
  clientNames: Record<string, string>;
  profile: BusinessProfile;
  lang?: AppLanguage;
}

function formatCHF(amount: number): string {
  return `CHF ${Math.abs(amount).toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 40,
    color: "#1a1a1a",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 25,
  },
  businessName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 4,
  },
  businessInfo: {
    fontSize: 8,
    color: "#666",
    lineHeight: 1.5,
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 5,
    marginBottom: 2,
  },
  thText: {
    fontSize: 7,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
  },
  rowAlt: {
    backgroundColor: "#f8f8f8",
  },
  cell: {
    fontSize: 8,
    paddingHorizontal: 2,
  },
  colRef: { width: 70 },
  colClient: { flex: 1 },
  colDate: { width: 70 },
  colDue: { width: 70 },
  colStatus: { width: 55 },
  colTotal: { width: 75, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1.5,
    borderTopColor: "#1a1a1a",
    paddingTop: 6,
    marginTop: 4,
  },
  boldCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingHorizontal: 2,
  },
  statusPaid: { color: "#16a34a" },
  statusOverdue: { color: "#dc2626" },
  statusSent: { color: "#d97706" },
  statusDraft: { color: "#6b7280" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#999",
    textAlign: "center",
  },
});

const statusStyle: Record<string, object> = {
  paid: s.statusPaid,
  overdue: s.statusOverdue,
  sent: s.statusSent,
  draft: s.statusDraft,
};

export function InvoicesListPDF({ year, invoices, clientNames, profile, lang = "FR" }: Props) {
  const t = getExportLabels(lang);
  const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = invoices.filter((i) => i.status === "paid").reduce((sum, inv) => sum + inv.total, 0);
  const dateFmt = lang === "FR" ? "fr-CH" : "en-CH";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.businessName}>{profile.owner_name}</Text>
            <View style={s.businessInfo}>
              <Text>{profile.address}</Text>
              <Text>{profile.postal_code} {profile.city}</Text>
            </View>
          </View>
          <Text style={s.businessInfo}>{new Date().toLocaleDateString(dateFmt)}</Text>
        </View>

        <Text style={s.title}>{t.invoices_title} {year}</Text>

        <View style={s.tableHeader}>
          <Text style={[s.thText, s.colRef]}>{t.reference}</Text>
          <Text style={[s.thText, s.colClient]}>{t.client}</Text>
          <Text style={[s.thText, s.colDate]}>{t.date}</Text>
          <Text style={[s.thText, s.colDue]}>{t.due_date}</Text>
          <Text style={[s.thText, s.colStatus]}>{t.status}</Text>
          <Text style={[s.thText, s.colTotal]}>{t.amount}</Text>
        </View>

        {invoices.map((inv, i) => (
          <View key={inv.id} style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}>
            <Text style={[s.cell, s.colRef]}>{inv.reference}</Text>
            <Text style={[s.cell, s.colClient]}>{clientNames[inv.client_id] ?? inv.client_id}</Text>
            <Text style={[s.cell, s.colDate]}>{inv.invoice_date}</Text>
            <Text style={[s.cell, s.colDue]}>{inv.due_date ?? ""}</Text>
            <Text style={[s.cell, s.colStatus, statusStyle[inv.status]] as never}>{inv.status}</Text>
            <Text style={[s.cell, s.colTotal]}>{formatCHF(inv.total)}</Text>
          </View>
        ))}

        <View style={s.totalRow}>
          <Text style={[s.boldCell, s.colRef]}></Text>
          <Text style={[s.boldCell, s.colClient]}>
            {invoices.length} {invoices.length !== 1 ? t.invoices : t.invoice}
          </Text>
          <Text style={[s.boldCell, s.colDate]}></Text>
          <Text style={[s.boldCell, s.colDue]}></Text>
          <Text style={[s.boldCell, s.colStatus]}>{t.collected}</Text>
          <Text style={[s.boldCell, s.colTotal]}>{formatCHF(totalPaid)}</Text>
        </View>
        <View style={{ flexDirection: "row", paddingTop: 2 }}>
          <Text style={[s.boldCell, s.colRef]}></Text>
          <Text style={[s.boldCell, s.colClient]}></Text>
          <Text style={[s.boldCell, s.colDate]}></Text>
          <Text style={[s.boldCell, s.colDue]}></Text>
          <Text style={[s.boldCell, s.colStatus]}>{t.total}</Text>
          <Text style={[s.boldCell, s.colTotal]}>{formatCHF(total)}</Text>
        </View>

        <Text style={s.footer}>
          {profile.owner_name} — {t.invoices_title} {year} — {t.generated_by}
        </Text>
      </Page>
    </Document>
  );
}
