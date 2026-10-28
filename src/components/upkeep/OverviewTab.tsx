import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { Badge, Card } from "../ui";
import { CollapsibleSection } from "./CollapsibleSection";
import { DueList } from "./DueList";
import { useMachines, useUpkeepOverview } from "../../db/hooks/useUpkeep";
import { useT } from "../../i18n/useT";
import { machineStatusVariant } from "../../lib/statusColors";
import { formatDisplayDate } from "../../utils/formatDate";
import type { Machine } from "../../types/upkeep";

function Quiet({ children }: { children: string }) {
  return <p className="text-sm text-muted py-2">{children}</p>;
}

function MachineCard({ machine, nextTitle }: { machine: Machine; nextTitle: string | null }) {
  const t = useT();
  const sub = [machine.kind, machine.location].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/upkeep/machines/${machine.id}`}
      className="block rounded-xl bg-[var(--color-surface)] p-4 hover:bg-[var(--color-hover-row)] transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-input-bg)] text-[var(--color-text-secondary)]">
          <Wrench size={18} strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{machine.name}</div>
          {sub && <div className="text-xs text-muted truncate">{sub}</div>}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant={machineStatusVariant(machine.status)}>
          {t[`machine_status_${machine.status}` as const]}
        </Badge>
        {nextTitle && <span className="text-xs text-muted truncate">{nextTitle}</span>}
      </div>
    </Link>
  );
}

export function OverviewTab() {
  const t = useT();
  const { due, lowStock, endingSoon, replacements } = useUpkeepOverview();
  const { data: machines = [] } = useMachines();

  const nextByMachine = new Map<number, string>();
  for (const r of due) if (!nextByMachine.has(r.machine.id)) nextByMachine.set(r.machine.id, r.item.title);

  return (
    <div className="space-y-6">
      <CollapsibleSection id="overview-due" title={t.upkeep_due_soon}>
        <Card padding={false}>
          {due.length === 0 ? (
            <div className="px-4 py-3"><Quiet>{t.upkeep_nothing_due}</Quiet></div>
          ) : (
            <DueList rows={due} />
          )}
        </Card>
      </CollapsibleSection>

      <div className="grid gap-6 md:grid-cols-2">
        <CollapsibleSection
          id="overview-low-stock"
          title={t.upkeep_low_stock}
          aside={
            <Link to="/upkeep?tab=consumables" className="text-xs text-accent hover:underline">
              {t.upkeep_all_consumables}
            </Link>
          }
        >
          <Card>
          {lowStock.length === 0 ? (
            <Quiet>{t.upkeep_low_stock_empty}</Quiet>
          ) : (
            <ul className="space-y-3">
              {lowStock.map((c) => (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{c.name}</span>
                    <span className="text-xs text-muted tabular-nums">{c.stock} / {c.reorder_level} {c.unit}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[var(--color-input-bg)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--color-danger)]"
                      style={{ width: `${Math.min(100, Math.max(0, (c.stock / c.reorder_level) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          </Card>
        </CollapsibleSection>

        <CollapsibleSection id="overview-ending" title={t.upkeep_warranty_renewals}>
          <Card>
          {endingSoon.length === 0 ? (
            <Quiet>{t.upkeep_warranty_renewals_empty}</Quiet>
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
        </CollapsibleSection>
      </div>

      <CollapsibleSection id="overview-replacements" title={t.upkeep_replacements}>
        <Card>
        {replacements.length === 0 ? (
          <Quiet>{t.upkeep_replacements_empty}</Quiet>
        ) : (
          <ul className="space-y-2">
            {replacements.map((r) => (
              <li key={r.machine.id} className="flex items-center justify-between text-sm">
                <Link to={`/upkeep/machines/${r.machine.id}`} className="hover:text-accent">{r.machine.name}</Link>
                <span className="text-xs text-muted">{t.upkeep_replace_around.replace("{year}", String(r.year))}</span>
              </li>
            ))}
          </ul>
        )}
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        id="overview-machines"
        title={t.upkeep_machines_count.replace("{count}", String(machines.length))}
        aside={
          <Link to="/upkeep?tab=machines" className="text-xs text-accent hover:underline">
            {t.upkeep_see_all}
          </Link>
        }
      >
        {machines.length === 0 ? (
          <Quiet>{t.upkeep_no_machines}</Quiet>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {machines.map((m) => (
              <MachineCard key={m.id} machine={m} nextTitle={nextByMachine.get(m.id) ?? null} />
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
