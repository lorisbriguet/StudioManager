import { Callout } from "../ui";
import { useBusinessProfile } from "../../db/hooks/useBusinessProfile";
import { useDashboardKPIs } from "../../db/hooks/useFinance";
import { useT } from "../../i18n/useT";
import { formatMoney } from "../../lib/money";
import { VAT_THRESHOLD_CHF, vatThresholdWarning } from "../../lib/vatThreshold";

/**
 * Above the dashboard grid: a VAT-exempt profile whose turnover this calendar
 * year reaches 80% of the VAT threshold. Always this year, whatever year the
 * dashboard shows, since only the running year can still be acted on.
 */
export function VatThresholdCallout() {
  const t = useT();
  const { data: profile } = useBusinessProfile();
  const { data: kpis } = useDashboardKPIs(new Date().getFullYear());
  if (!profile || !kpis) return null;
  const turnover = kpis.total_invoiced;
  const share = vatThresholdWarning(turnover, profile.vat_exempt === 1);
  if (share == null) return null;
  return (
    <Callout tone="warning" className="mb-4">
      {t.vat_threshold_warning
        .replace("{turnover}", formatMoney(turnover, "CHF"))
        .replace("{percent}", String(Math.floor(share * 100)))
        .replace("{threshold}", formatMoney(VAT_THRESHOLD_CHF, "CHF"))}
    </Callout>
  );
}
