// Small pieces the dashboard widget files share.
import { priorityDotClass } from "../../lib/statusColors";
import { formatMoney } from "../../lib/money";

export function formatCHF(amount: number): string {
  return formatMoney(amount, "CHF");
}

export function PriorityDot({ priority }: { priority: string }) {
  return <span className={`dot-sm ${priorityDotClass(priority)}`} />;
}

/** A KPI widget fills its Card frame: the frame's 16px padding, centred vertically. */
export const KPI_TILE = "h-full justify-center p-4";
