import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, EmptyState, ICONS, PanelTitle, QueryState, Table, TableSkeleton } from "../ui";
import { SidePeek } from "../layout/SidePeek";
import { MachineDetail } from "./MachineDetail";
import { MachineForm } from "./MachineForm";
import { useT } from "../../i18n/useT";
import { useActiveUpkeepItems, useMachines } from "../../db/hooks/useUpkeep";
import { machineStatusVariant } from "../../lib/statusColors";
import { effectiveDue } from "../../lib/upkeep/schedule";
import { formatDisplayDate } from "../../utils/formatDate";
import { useAppStore } from "../../stores/app-store";
import { machineKindLabel } from "../../lib/upkeep/templates";

/** Machines table; a row opens the detail in a half-width peek panel, Maximize2 opens the full page. */
export function MachinesTab() {
  const t = useT();
  const lang = useAppStore((s) => s.language);
  const navigate = useNavigate();
  const machinesQuery = useMachines();
  const machines = machinesQuery.data ?? [];
  const { data: items = [] } = useActiveUpkeepItems();
  const [peekId, setPeekId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const nextByMachine = useMemo(() => {
    const map = new Map<number, { title: string; due: string }>();
    for (const it of items) {
      const due = effectiveDue(it);
      if (!due) continue;
      const cur = map.get(it.machine_id);
      if (!cur || due < cur.due) map.set(it.machine_id, { title: it.title, due });
    }
    return map;
  }, [items]);

  const addButton = <Button icon={ICONS.add} onClick={() => setAdding(true)}>{t.upkeep_add_machine}</Button>;

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <PanelTitle title={t.upkeep_tab_machines} count={machines.length} action={addButton} className="mb-2" />
        <QueryState query={machinesQuery} skeleton={<TableSkeleton columns={5} />} errorMessage={t.load_error_upkeep}>
        {() => (
        <Table>
          <Table.Head>
            <Table.Th>{t.name}</Table.Th>
            <Table.Th>{t.upkeep_kind}</Table.Th>
            <Table.Th>{t.upkeep_location}</Table.Th>
            <Table.Th>{t.upkeep_col_status}</Table.Th>
            <Table.Th>{t.upkeep_next_upkeep}</Table.Th>
          </Table.Head>
          <Table.Body>
            {machines.map((m) => {
              const next = nextByMachine.get(m.id);
              return (
                <Table.Row
                  key={m.id}
                  selected={peekId === m.id}
                  data-machine-id={m.id}
                  onOpen={() => setPeekId(m.id)}
                >
                  <Table.Td className="font-medium">{m.name}</Table.Td>
                  <Table.Td muted>{machineKindLabel(m.kind, lang)}</Table.Td>
                  <Table.Td muted>{m.location}</Table.Td>
                  <Table.Td>
                    <Badge variant={machineStatusVariant(m.status)}>{t[`machine_status_${m.status}` as const]}</Badge>
                  </Table.Td>
                  <Table.Td muted className="tabular-nums">
                    {next ? `${formatDisplayDate(next.due)} · ${next.title}` : ""}
                  </Table.Td>
                </Table.Row>
              );
            })}
            {machines.length === 0 && (
              <Table.Empty colSpan={5}>
                <EmptyState icon={ICONS.upkeep} message={t.upkeep_no_machines} action={addButton} />
              </Table.Empty>
            )}
          </Table.Body>
        </Table>
        )}
        </QueryState>
      </div>

      {peekId !== null && (
        <SidePeek
          focusKey={peekId}
          className="ml-4 border-l border-[var(--color-border-divider)]"
          onClose={() => setPeekId(null)}
          onOpenFull={() => navigate(`/upkeep/machines/${peekId}`)}
          returnFocus={() => document.querySelector<HTMLElement>(`[data-machine-id="${peekId}"]`)}
        >
          <MachineDetail key={peekId} machineId={peekId} compact onDeleted={() => setPeekId(null)} />
        </SidePeek>
      )}

      {adding && <MachineForm onClose={() => setAdding(false)} onSaved={(id) => setPeekId(id)} />}
    </div>
  );
}
