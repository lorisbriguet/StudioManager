import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, EmptyState, ICONS, PeekHeader, Table } from "../ui";
import { MachineDetail } from "./MachineDetail";
import { MachineForm } from "./MachineForm";
import { useT } from "../../i18n/useT";
import { useActiveUpkeepItems, useMachines } from "../../db/hooks/useUpkeep";
import { machineStatusVariant } from "../../lib/statusColors";
import { effectiveDue } from "../../lib/upkeep/schedule";
import { formatDisplayDate } from "../../utils/formatDate";

/** Machines table; a row opens the detail in a half-width peek panel, Maximize2 opens the full page. */
export function MachinesTab() {
  const t = useT();
  const navigate = useNavigate();
  const { data: machines = [] } = useMachines();
  const { data: items = [] } = useActiveUpkeepItems();
  const [peekId, setPeekId] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
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
        <div className="flex justify-end mb-3">{addButton}</div>
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
                  onOpen={() => { setClosing(false); setPeekId(m.id); }}
                >
                  <Table.Td className="font-medium">{m.name}</Table.Td>
                  <Table.Td muted>{m.kind}</Table.Td>
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
      </div>

      {peekId !== null && (
        <div
          className={`shrink-0 w-1/2 ml-4 border-l border-[var(--color-border-divider)] ${closing ? "peek-exit" : "peek-enter"}`}
          onAnimationEnd={() => { if (closing) { setPeekId(null); setClosing(false); } }}
        >
          <PeekHeader onClose={() => setClosing(true)} onOpenFull={() => navigate(`/upkeep/machines/${peekId}`)} />
          <div className="p-4">
            <MachineDetail key={peekId} machineId={peekId} compact onDeleted={() => { setPeekId(null); setClosing(false); }} />
          </div>
        </div>
      )}

      {adding && <MachineForm onClose={() => setAdding(false)} onSaved={(id) => { setClosing(false); setPeekId(id); }} />}
    </div>
  );
}
