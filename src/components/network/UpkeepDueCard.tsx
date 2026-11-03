import { Card, EmptyState, ICONS } from "../ui";
import { DueList } from "../upkeep/DueList";
import { useT } from "../../i18n/useT";
import type { DueRow } from "../../lib/upkeep/overview";

/** Due and overdue upkeep of the machines on the page: the dashboard widget's rows. */
export function UpkeepDueCard({ rows }: { rows: DueRow[] }) {
  const t = useT();
  return (
    <Card as="section">
      <Card.Header title={t.network_upkeep_due} />
      {rows.length > 0 ? <DueList rows={rows} compact /> : <EmptyState size="sm" icon={ICONS.done} message={t.net_nothing_due} />}
    </Card>
  );
}
