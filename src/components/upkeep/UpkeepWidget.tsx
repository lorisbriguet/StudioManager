import { Link } from "react-router-dom";
import { Badge, EmptyState, ICONS, SectionLabel } from "../ui";
import { WidgetShell, WidgetTitle } from "../dashboard/WidgetShell";
import { DueList } from "./DueList";
import { usePendingRenewals, useUpkeepOverview } from "../../db/hooks/useUpkeep";
import { useT } from "../../i18n/useT";
import { formatMoney } from "../../lib/upkeep/money";
import { formatDisplayDate } from "../../utils/formatDate";

/** Dashboard widget: what needs attention in the studio. Sections with nothing in them are hidden. */
export function UpkeepWidget() {
  const t = useT();
  const { due, lowStock, endingSoon } = useUpkeepOverview();
  const { data: pending = [] } = usePendingRenewals();

  const nothing = due.length === 0 && lowStock.length === 0 && endingSoon.length === 0 && pending.length === 0;

  return (
    <WidgetShell>
      <WidgetTitle>{t.upkeep_widget}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-3">
        {nothing && <EmptyState size="sm" icon={ICONS.done} message={t.upkeep_widget_empty} />}

        {due.length > 0 && (
          <section>
            <SectionLabel as="h3" className="mb-1">{t.upkeep_due_soon}</SectionLabel>
            <DueList rows={due} compact />
          </section>
        )}

        {pending.length > 0 && (
          <section>
            <SectionLabel as="h3" className="mb-1">{t.upkeep_widget_pending}</SectionLabel>
            <ul className="space-y-1">
              {pending.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/upkeep?tab=subscriptions"
                    className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2"
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="text-xs text-muted ml-auto shrink-0 tabular-nums">
                      {formatMoney(r.amount, r.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {lowStock.length > 0 && (
          <section>
            <SectionLabel
              as="h3"
              className="mb-1"
              action={
                <Link to="/upkeep?tab=consumables" className="text-xs text-accent-text hover:underline">
                  {t.upkeep_all_consumables}
                </Link>
              }
            >
              {t.upkeep_low_stock}
            </SectionLabel>
            <ul className="space-y-1">
              {lowStock.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{c.name}</span>
                  <span className="text-xs text-muted tabular-nums shrink-0">
                    {c.stock} / {c.reorder_level} {c.unit}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {endingSoon.length > 0 && (
          <section>
            <SectionLabel as="h3" className="mb-1">{t.upkeep_warranty_renewals}</SectionLabel>
            <ul className="space-y-1">
              {endingSoon.map((e) => (
                <li key={`${e.kind}-${e.name}-${e.date}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{e.name}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge variant={e.kind === "warranty" ? "warning" : "indigo"}>
                      {e.kind === "warranty" ? t.upkeep_warranty_ends : t.upkeep_renews}
                    </Badge>
                    <span className="text-xs text-muted tabular-nums">{formatDisplayDate(e.date)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </WidgetShell>
  );
}
