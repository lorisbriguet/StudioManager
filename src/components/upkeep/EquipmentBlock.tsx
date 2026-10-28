import { Link } from "react-router-dom";
import { SectionTitle } from "./MachineLogSections";
import { useMachinesByProject, useProjectMaterialCost } from "../../db/hooks/useUpkeep";
import { useT } from "../../i18n/useT";
import { formatMoney } from "../../lib/upkeep/money";
import type { ProjectMaterialCostRow } from "../../db/queries/consumables";

/** Material cost summed per currency, in order of first appearance; never mixes currencies. */
export function sumByCurrency(rows: Pick<ProjectMaterialCostRow, "cost" | "currency">[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const cur = r.currency ?? "";
    totals.set(cur, (totals.get(cur) ?? 0) + r.cost);
  }
  return [...totals.entries()];
}

/** Project block: machines linked to the project and the materials used on it. */
export function EquipmentBlock({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: machines = [] } = useMachinesByProject(projectId);
  const { data: costs = [] } = useProjectMaterialCost(projectId);

  if (machines.length === 0 && costs.length === 0) {
    return <p className="text-xs text-muted">{t.equipment_empty}</p>;
  }

  const totals = sumByCurrency(costs);

  return (
    <div className="space-y-3">
      {machines.length > 0 && (
        <section>
          <SectionTitle variant="label">{t.equipment_machines}</SectionTitle>
          <ul className="space-y-1">
            {machines.map((m) => (
              <li key={m.id}>
                <Link
                  to={`/upkeep/machines/${m.id}`}
                  className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2"
                >
                  <span className="truncate">{m.name}</span>
                  {m.kind && <span className="text-xs text-muted ml-auto shrink-0">{m.kind}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {costs.length > 0 && (
        <section>
          <SectionTitle variant="label">{t.equipment_materials}</SectionTitle>
          <ul className="space-y-1">
            {costs.map((c) => (
              <li key={`${c.name}-${c.unit}-${c.currency}`} className="flex items-center justify-between text-sm">
                <span className="truncate">{c.name}</span>
                <span className="text-xs text-muted tabular-nums shrink-0">
                  {c.amount} {c.unit} · {formatMoney(c.cost, c.currency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-2 border-t border-[var(--color-border-divider)] text-sm">
            {totals.map(([cur, amount]) => (
              <div
                key={cur}
                data-testid={`equipment-total-${cur}`}
                className="flex items-center justify-between font-medium"
              >
                <span>{t.equipment_total}</span>
                <span className="tabular-nums">{formatMoney(amount, cur)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
