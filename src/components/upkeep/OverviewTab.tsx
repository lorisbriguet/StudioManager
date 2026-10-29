import { Link } from "react-router-dom";
import { Badge, CARD_GAP, CARD_LINK, CARD_STACK, Card, EmptyState, HEADING_2, ICONS, ICON_SIZE, ProgressBar } from "../ui";
import { DueList } from "./DueList";
import { useMachines, useUpkeepOverview } from "../../db/hooks/useUpkeep";
import { useT } from "../../i18n/useT";
import { machineStatusVariant } from "../../lib/statusColors";
import { formatDisplayDate } from "../../utils/formatDate";
import type { Machine } from "../../types/upkeep";

function MachineCard({ machine, nextTitle }: { machine: Machine; nextTitle: string | null }) {
  const t = useT();
  const sub = [machine.kind, machine.location].filter(Boolean).join(" · ");
  return (
    <Card interactive="link">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-input-bg)] text-[var(--color-text-secondary)]">
          <ICONS.upkeep size={ICON_SIZE.menu} />
        </span>
        <div className="min-w-0">
          <h3 className={`${HEADING_2} truncate`}>
            <Link to={`/upkeep/machines/${machine.id}`} className={CARD_LINK}>{machine.name}</Link>
          </h3>
          {sub && <div className="text-xs text-muted truncate">{sub}</div>}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant={machineStatusVariant(machine.status)}>
          {t[`machine_status_${machine.status}` as const]}
        </Badge>
        {nextTitle && <span className="text-xs text-muted truncate">{nextTitle}</span>}
      </div>
    </Card>
  );
}

export function OverviewTab() {
  const t = useT();
  const { due, lowStock, endingSoon, replacements } = useUpkeepOverview();
  const { data: machines = [] } = useMachines();

  const nextByMachine = new Map<number, string>();
  for (const r of due) if (!nextByMachine.has(r.machine.id)) nextByMachine.set(r.machine.id, r.item.title);

  return (
    <div className={CARD_STACK}>
      <Card padding="none">
        <Card.Header title={t.upkeep_due_soon} className="px-4 pt-4 mb-3" />
        {due.length === 0 ? (
          <EmptyState size="sm" icon={ICONS.done} message={t.upkeep_nothing_due} />
        ) : (
          <DueList rows={due} />
        )}
      </Card>

      <div className={`grid ${CARD_GAP} md:grid-cols-2`}>
        <Card>
          <Card.Header
            title={t.upkeep_low_stock}
            action={
              <Link to="/upkeep?tab=consumables" className="text-xs text-accent-text hover:underline">
                {t.upkeep_all_consumables}
              </Link>
            }
          />
          {lowStock.length === 0 ? (
            <EmptyState size="sm" message={t.upkeep_low_stock_empty} />
          ) : (
            <ul className="space-y-3">
              {lowStock.map((c) => (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{c.name}</span>
                    <span className="text-xs text-muted tabular-nums">{c.stock} / {c.reorder_level} {c.unit}</span>
                  </div>
                  <ProgressBar className="mt-1" value={(c.stock / c.reorder_level) * 100} tone="danger" aria-label={c.name} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <Card.Header title={t.upkeep_warranty_renewals} />
          {endingSoon.length === 0 ? (
            <EmptyState size="sm" message={t.upkeep_warranty_renewals_empty} />
          ) : (
            <ul className="space-y-2">
              {endingSoon.map((e) => (
                <li key={`${e.kind}-${e.name}`} className="flex items-center justify-between gap-3 text-sm">
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
          )}
        </Card>
      </div>

      <Card>
        <Card.Header title={t.upkeep_replacements} />
        {replacements.length === 0 ? (
          <EmptyState size="sm" message={t.upkeep_replacements_empty} />
        ) : (
          <ul className="space-y-2">
            {replacements.map((r) => (
              <li key={r.machine.id} className="flex items-center justify-between text-sm">
                <Link to={`/upkeep/machines/${r.machine.id}`} className="hover:text-accent-text">{r.machine.name}</Link>
                <span className="text-xs text-muted">{t.upkeep_replace_around.replace("{year}", String(r.year))}</span>
              </li>
            ))}
          </ul>
        )}
        </Card>

      <section>
        <Card.Header
          title={t.upkeep_tab_machines}
          count={machines.length}
          action={
            <Link to="/upkeep?tab=machines" className="text-xs text-accent-text hover:underline">
              {t.upkeep_see_all}
            </Link>
          }
        />
        {machines.length === 0 ? (
          <EmptyState size="sm" icon={ICONS.upkeep} message={t.upkeep_no_machines} />
        ) : (
          <div className={`grid ${CARD_GAP} sm:grid-cols-2 xl:grid-cols-3`}>
            {machines.map((m) => (
              <MachineCard key={m.id} machine={m} nextTitle={nextByMachine.get(m.id) ?? null} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
