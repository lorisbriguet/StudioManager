import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Expense } from "../../types/expense";
import type { BusinessProfile } from "../../types/business-profile";
import type { AppLanguage } from "../../i18n/ui";
import { getExportLabels } from "../../i18n/export-labels";

export interface Props {
  year: number;
  expenses: Expense[];
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
  colRef: { width: 65 },
  colSupplier: { flex: 1 },
  colCategory: { width: 35 },
  colDate: { width: 68 },
  colPaid: { width: 68 },
  colAmount: { width: 75, textAlign: "right" },
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
  subtotalSection: {
    marginTop: 20,
    marginBottom: 10,
  },
  subtotalTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  subtotalLabel: {
    fontSize: 9,
  },
  subtotalValue: {
    fontSize: 9,
    width: 80,
    textAlign: "right",
  },
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

export function ExpensesListPDF({ year, expenses, profile, lang = "FR" }: Props) {
  const t = getExportLabels(lang);
  const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const dateFmt = lang === "FR" ? "fr-CH" : "en-CH";

  // Group by category for subtotals
  const byCategory = new Map<string, number>();
  for (const exp of expenses) {
    byCategory.set(exp.category_code, (byCategory.get(exp.category_code) ?? 0) + exp.amount);
  }
  const categoryTotals = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));

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

        <Text style={s.title}>{t.expenses_title} {year}</Text>

        <View style={s.tableHeader}>
          <Text style={[s.thText, s.colRef]}>{t.reference}</Text>
          <Text style={[s.thText, s.colSupplier]}>{t.supplier}</Text>
          <Text style={[s.thText, s.colCategory]}>{t.cat}</Text>
          <Text style={[s.thText, s.colDate]}>{t.date}</Text>
          <Text style={[s.thText, s.colPaid]}>{t.paid}</Text>
          <Text style={[s.thText, s.colAmount]}>{t.amount}</Text>
        </View>

        {expenses.map((exp, i) => (
          <View key={exp.id} style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}>
            <Text style={[s.cell, s.colRef]}>{exp.reference}</Text>
            <Text style={[s.cell, s.colSupplier]}>{exp.supplier}</Text>
            <Text style={[s.cell, s.colCategory]}>{exp.category_code}</Text>
            <Text style={[s.cell, s.colDate]}>{exp.invoice_date}</Text>
            <Text style={[s.cell, s.colPaid]}>{exp.paid_date ?? ""}</Text>
            <Text style={[s.cell, s.colAmount]}>{formatCHF(exp.amount)}</Text>
          </View>
        ))}

        <View style={s.totalRow}>
          <Text style={[s.boldCell, s.colRef]}></Text>
          <Text style={[s.boldCell, s.colSupplier]}>
            {expenses.length} {expenses.length !== 1 ? t.expenses_plural : t.expense}
          </Text>
          <Text style={[s.boldCell, s.colCategory]}></Text>
          <Text style={[s.boldCell, s.colDate]}></Text>
          <Text style={[s.boldCell, s.colPaid]}>{t.total}</Text>
          <Text style={[s.boldCell, s.colAmount]}>{formatCHF(total)}</Text>
        </View>

        {/* Category subtotals */}
        <View style={s.subtotalSection}>
          <Text style={s.subtotalTitle}>{t.category_breakdown}</Text>
          {categoryTotals.map(([code, catTotal], i) => (
            <View key={code} style={[s.subtotalRow, i % 2 === 1 ? { backgroundColor: "#f8f8f8" } : {}]}>
              <Text style={s.subtotalLabel}>{code}</Text>
              <Text style={s.subtotalValue}>{formatCHF(catTotal)}</Text>
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: "#ddd", marginTop: 4, paddingTop: 4 }}>
            <View style={s.subtotalRow}>
              <Text style={[s.subtotalLabel, { fontFamily: "Helvetica-Bold" }]}>{t.total}</Text>
              <Text style={[s.subtotalValue, { fontFamily: "Helvetica-Bold" }]}>{formatCHF(total)}</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer}>
          {profile.owner_name} — {t.expenses_title} {year} — {t.generated_by}
        </Text>
      </Page>
    </Document>
  );
}
