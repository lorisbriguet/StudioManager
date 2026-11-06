import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Income } from "../../types/income";
import type { BusinessProfile } from "../../types/business-profile";
import type { AppLanguage } from "../../i18n/ui";
import { getExportLabels, type ExportLabels } from "../../i18n/export-labels";
import { PDF } from "../pdf/pdfPalette";

/** The trustee export's list of other income (the `income` table), laid out
 *  like ExpensesListPDF so the three lists of the folder read alike. */
export interface Props {
  year: number;
  incomes: Income[];
  profile: BusinessProfile;
  lang?: AppLanguage;
}

function formatCHF(amount: number): string {
  const formatted = Math.abs(amount).toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `CHF ${amount < 0 ? "-" : ""}${formatted}`;
}

/** Category codes are stored raw; unknown ones fall back to the code itself. */
function categoryLabel(t: ExportLabels, code: string): string {
  const key = `income_cat_${code}` as keyof ExportLabels;
  return t[key] ?? code.replace(/_/g, " ");
}

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 40,
    color: PDF.ink,
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
    color: PDF.muted,
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
    borderBottomColor: PDF.ink,
    paddingBottom: 5,
    marginBottom: 2,
  },
  thText: {
    fontSize: 7,
    color: PDF.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF.ruleLight,
  },
  rowAlt: {
    backgroundColor: PDF.stripe,
  },
  cell: {
    fontSize: 8,
    paddingHorizontal: 2,
  },
  colRef: { width: 60 },
  colDesc: { flex: 1 },
  colSource: { width: 95 },
  colCategory: { width: 80 },
  colDate: { width: 60 },
  colAmount: { width: 75, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1.5,
    borderTopColor: PDF.ink,
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
    color: PDF.faint,
    textAlign: "center",
  },
});

export function IncomeListPDF({ year, incomes, profile, lang = "FR" }: Props) {
  const t = getExportLabels(lang);
  const total = incomes.reduce((sum, inc) => sum + inc.amount, 0);
  const dateFmt = lang === "FR" ? "fr-CH" : "en-CH";

  const byCategory = new Map<string, number>();
  for (const inc of incomes) {
    byCategory.set(inc.category, (byCategory.get(inc.category) ?? 0) + inc.amount);
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

        <Text style={s.title}>{t.income_title} {year}</Text>

        <View style={s.tableHeader}>
          <Text style={[s.thText, s.colRef]}>{t.reference}</Text>
          <Text style={[s.thText, s.colDesc]}>{t.description}</Text>
          <Text style={[s.thText, s.colSource]}>{t.source}</Text>
          <Text style={[s.thText, s.colCategory]}>{t.category}</Text>
          <Text style={[s.thText, s.colDate]}>{t.date}</Text>
          <Text style={[s.thText, s.colAmount]}>{t.amount}</Text>
        </View>

        {incomes.map((inc, i) => (
          <View key={inc.id} style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}>
            <Text style={[s.cell, s.colRef]}>{inc.reference}</Text>
            <Text style={[s.cell, s.colDesc]}>{inc.description}</Text>
            <Text style={[s.cell, s.colSource]}>{inc.source}</Text>
            <Text style={[s.cell, s.colCategory]}>{categoryLabel(t, inc.category)}</Text>
            <Text style={[s.cell, s.colDate]}>{inc.date}</Text>
            <Text style={[s.cell, s.colAmount]}>{formatCHF(inc.amount)}</Text>
          </View>
        ))}

        <View style={s.totalRow}>
          <Text style={[s.boldCell, s.colRef]}></Text>
          <Text style={[s.boldCell, s.colDesc]}>
            {incomes.length} {incomes.length !== 1 ? t.income_entries : t.income_entry}
          </Text>
          <Text style={[s.boldCell, s.colSource]}></Text>
          <Text style={[s.boldCell, s.colCategory]}></Text>
          <Text style={[s.boldCell, s.colDate]}>{t.total}</Text>
          <Text style={[s.boldCell, s.colAmount]}>{formatCHF(total)}</Text>
        </View>

        <View style={s.subtotalSection}>
          <Text style={s.subtotalTitle}>{t.category_breakdown}</Text>
          {categoryTotals.map(([code, catTotal], i) => (
            <View key={code} style={[s.subtotalRow, i % 2 === 1 ? { backgroundColor: PDF.stripe } : {}]}>
              <Text style={s.subtotalLabel}>{categoryLabel(t, code)}</Text>
              <Text style={s.subtotalValue}>{formatCHF(catTotal)}</Text>
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: PDF.rule, marginTop: 4, paddingTop: 4 }}>
            <View style={s.subtotalRow}>
              <Text style={[s.subtotalLabel, { fontFamily: "Helvetica-Bold" }]}>{t.total}</Text>
              <Text style={[s.subtotalValue, { fontFamily: "Helvetica-Bold" }]}>{formatCHF(total)}</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer}>
          {profile.owner_name} — {t.income_title} {year} — {t.generated_by}
        </Text>
      </Page>
    </Document>
  );
}
