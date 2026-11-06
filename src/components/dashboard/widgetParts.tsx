// Small pieces the dashboard widget files share.
import { priorityDotClass } from "../../lib/statusColors";
import { formatMoney } from "../../lib/money";
import { useT } from "../../i18n/useT";

export function formatCHF(amount: number): string {
  return formatMoney(amount, "CHF");
}

/** Priority dot; its name ("Priority: High") is the tooltip and screen-reader label. */
export function PriorityDot({ priority }: { priority: string }) {
  const t = useT();
  const name = (t as Record<string, string>)[`priority_${priority}`] ?? priority;
  const label = `${t.priority}: ${name}`;
  return <span role="img" aria-label={label} title={label} className={`dot-sm ${priorityDotClass(priority)}`} />;
}

/** A KPI widget fills its Card frame: the frame's 16px padding, centred vertically. */
export const KPI_TILE = "h-full justify-center p-4";
