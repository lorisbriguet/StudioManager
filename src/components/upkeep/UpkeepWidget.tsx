import { Link } from "react-router-dom";
import { Badge } from "../ui";
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
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.upkeep_widget}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-3">
        {nothing && <div className="text-xs text-muted">{t.upkeep_widget_empty}</div>}

        {due.length > 0 && (
          <section>
            <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted">{t.upkeep_due_soon}</h3>
            <DueList rows={due} compact />
          </section>
        )}

        {pending.length > 0 && (
          <section>
            <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted">{t.upkeep_widget_pending}</h3>
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
            <div className="flex items-center justify-between mb-1">
  <h3 className="text-[10px] font-medium uppercase tracking-widest text-muted">{t.upkeep_low_stock}</h3>
              <Link to="/upkeep?tab=consumables" className="text-xs text-accent hover:underline">
                {t.upkeep_all_consumables}
              </Link>
            </div>
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
            <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted">{t.upkeep_warranty_renewals}</h3>
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
    </div>
  );
}
