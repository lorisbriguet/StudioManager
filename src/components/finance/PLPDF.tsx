import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { PLData } from "../../types/finance";
import type { MonthlyData } from "../../db/queries/finance";
import type { BusinessProfile } from "../../types/business-profile";
import type { AppLanguage } from "../../i18n/ui";
import { getExportLabels, getMonthNames } from "../../i18n/export-labels";

export interface PLPDFProps {
  year: number;
  pl: PLData;
  monthly: MonthlyData[];
  profile: BusinessProfile;
  lang?: AppLanguage;
}

function formatCHF(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "- " : ""}CHF ${formatted}`;
}

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 50,
    color: "#1a1a1a",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
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
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 9,
    color: "#666",
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 10,
    marginTop: 5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  rowAlt: {
    backgroundColor: "#f8f8f8",
  },
  rowLabel: {
    fontSize: 9,
    flex: 1,
  },
  rowValue: {
    fontSize: 9,
    width: 100,
    textAlign: "right",
  },
  boldLabel: {
    fontFamily: "Helvetica-Bold",
  },
  negativeValue: {
    color: "#dc2626",
  },
  separator: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    marginVertical: 4,
  },
  grandSeparator: {
    borderBottomWidth: 2,
    borderBottomColor: "#1a1a1a",
    marginTop: 6,
    marginBottom: 6,
  },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  grandLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  grandValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    width: 100,
    textAlign: "right",
  },
  monthlySection: {
    marginTop: 30,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 4,
    marginBottom: 2,
  },
  thText: {
    fontSize: 7,
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  colMonth: { width: 60 },
  colRevenue: { width: 90, textAlign: "right" },
  colExpenses: { width: 90, textAlign: "right" },
  colNet: { width: 90, textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  tableTotalRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    marginTop: 2,
  },
  cellText: {
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 50,
    right: 50,
    fontSize: 7,
    color: "#999",
    textAlign: "center",
  },
});

export function PLPDF({ year, pl, monthly, profile, lang = "FR" }: PLPDFProps) {
  const t = getExportLabels(lang);
  const months = getMonthNames(lang);
  const totalMonthlyRevenue = monthly.reduce((s, m) => s + m.revenue, 0);
  const totalMonthlyExpenses = monthly.reduce((s, m) => s + m.expenses, 0);
  const dateFmt = lang === "FR" ? "fr-CH" : "en-CH";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.businessName}>{profile.owner_name}</Text>
            <View style={s.businessInfo}>
              <Text>{profile.address}</Text>
              <Text>{profile.postal_code} {profile.city}</Text>
              {profile.ide_number && <Text>{t.ide}: {profile.ide_number}</Text>}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.businessInfo}>
              {new Date().toLocaleDateString(dateFmt)}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text style={s.title}>{t.pl_title} {year}</Text>
        <Text style={s.subtitle}>{t.pl_subtitle}</Text>

        {/* Revenue */}
        <Text style={s.sectionTitle}>{t.revenue}</Text>
        <View style={s.row}>
          <Text style={[s.rowLabel, s.boldLabel]}>{t.total_invoiced}</Text>
          <Text style={[s.rowValue, s.boldLabel]}>{formatCHF(pl.revenue)}</Text>
        </View>

        <View style={s.separator} />

        {/* Operating expenses */}
        <Text style={s.sectionTitle}>{t.operating_expenses}</Text>
        {pl.operating_expenses.map((cat, i) => (
          <View key={cat.category_code} style={[s.row, i % 2 === 1 ? s.rowAlt : {}]}>
            <Text style={s.rowLabel}>{cat.category_code} - {cat.name_fr}</Text>
            <Text style={[s.rowValue, s.negativeValue]}>{formatCHF(-cat.total)}</Text>
          </View>
        ))}
        <View style={s.separator} />
        <View style={s.row}>
          <Text style={[s.rowLabel, s.boldLabel]}>{t.total_operating}</Text>
          <Text style={[s.rowValue, s.boldLabel, s.negativeValue]}>{formatCHF(-pl.total_operating)}</Text>
        </View>

        {/* Operating net */}
        <View style={[s.row, { marginTop: 6 }]}>
          <Text style={[s.rowLabel, s.boldLabel]}>{t.operating_net}</Text>
          <Text style={[s.rowValue, s.boldLabel]}>{formatCHF(pl.operating_net)}</Text>
        </View>

        <View style={s.separator} />

        {/* Social charges */}
        <Text style={s.sectionTitle}>{t.social_charges}</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>{t.social_charges_label}</Text>
          <Text style={[s.rowValue, s.negativeValue]}>{formatCHF(-pl.social_charges)}</Text>
        </View>

        {/* Net result */}
        <View style={s.grandSeparator} />
        <View style={s.grandRow}>
          <Text style={s.grandLabel}>{t.net_result}</Text>
          <Text style={[s.grandValue, pl.net_result < 0 ? s.negativeValue : {}]}>
            {formatCHF(pl.net_result)}
          </Text>
        </View>

        {/* Monthly breakdown */}
        <View style={s.monthlySection}>
          <Text style={s.sectionTitle}>{t.monthly_breakdown}</Text>
          <View style={s.tableHeader}>
            <Text style={[s.thText, s.colMonth]}>{t.month}</Text>
            <Text style={[s.thText, s.colRevenue]}>{t.revenue}</Text>
            <Text style={[s.thText, s.colExpenses]}>{t.expenses}</Text>
            <Text style={[s.thText, s.colNet]}>{t.net}</Text>
          </View>
          {monthly.map((m, i) => (
            <View key={m.month} style={[s.tableRow, i % 2 === 1 ? s.rowAlt : {}]}>
              <Text style={[s.cellText, s.colMonth]}>{months[i]}</Text>
              <Text style={[s.cellText, s.colRevenue]}>{formatCHF(m.revenue)}</Text>
              <Text style={[s.cellText, s.colExpenses, s.negativeValue]}>
                {m.expenses > 0 ? formatCHF(-m.expenses) : "\u2014"}
              </Text>
              <Text style={[s.cellText, s.colNet]}>
                {formatCHF(m.revenue - m.expenses)}
              </Text>
            </View>
          ))}
          <View style={s.tableTotalRow}>
            <Text style={[s.cellText, s.colMonth, s.boldLabel]}>{t.total}</Text>
            <Text style={[s.cellText, s.colRevenue, s.boldLabel]}>{formatCHF(totalMonthlyRevenue)}</Text>
            <Text style={[s.cellText, s.colExpenses, s.boldLabel, s.negativeValue]}>{formatCHF(-totalMonthlyExpenses)}</Text>
            <Text style={[s.cellText, s.colNet, s.boldLabel]}>{formatCHF(totalMonthlyRevenue - totalMonthlyExpenses)}</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          {profile.owner_name} — {t.accounting} {year} — {t.generated_by}
        </Text>
      </Page>
    </Document>
  );
}
