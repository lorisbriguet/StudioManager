import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Maximize2, Plus, X } from "lucide-react";
import { Badge, Button, EmptyState } from "../ui";
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

  const head = "px-4 py-2.5 text-left text-xs font-normal text-muted border-b border-[var(--color-border-header)] whitespace-nowrap";
  const cell = "px-4 py-2.5";
  const iconBtn = "p-1.5 rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text-secondary)]";

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <div className="flex justify-end mb-3">
          <Button icon={<Plus size={14} />} onClick={() => setAdding(true)}>{t.upkeep_add_machine}</Button>
        </div>
        {machines.length === 0 ? (
          <EmptyState message={t.upkeep_no_machines} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={head}>{t.name}</th>
                <th className={head}>{t.upkeep_kind}</th>
                <th className={head}>{t.upkeep_location}</th>
                <th className={head}>{t.upkeep_col_status}</th>
                <th className={head}>{t.upkeep_next_upkeep}</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => {
                const next = nextByMachine.get(m.id);
                return (
                  <tr
                    key={m.id}
                    onClick={() => { setClosing(false); setPeekId(m.id); }}
                    className={`cursor-pointer border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors ${
                      peekId === m.id ? "bg-[var(--color-hover-row)]" : ""
                    }`}
                  >
                    <td className={`${cell} font-medium`}>{m.name}</td>
                    <td className={`${cell} text-muted`}>{m.kind}</td>
                    <td className={`${cell} text-muted`}>{m.location}</td>
                    <td className={cell}>
                      <Badge variant={machineStatusVariant(m.status)}>{t[`machine_status_${m.status}` as const]}</Badge>
                    </td>
                    <td className={`${cell} text-muted tabular-nums`}>
                      {next ? `${formatDisplayDate(next.due)} · ${next.title}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {peekId !== null && (
        <div
          className={`shrink-0 w-1/2 ml-4 border-l border-[var(--color-border-divider)] ${closing ? "peek-exit" : "peek-enter"}`}
          onAnimationEnd={() => { if (closing) { setPeekId(null); setClosing(false); } }}
        >
          <div className="flex items-center gap-1 p-2 border-b border-[var(--color-border-header)]">
            <button type="button" className={iconBtn} aria-label={t.close} onClick={() => setClosing(true)}>
              <X size={14} />
            </button>
            <div className="flex-1" />
            <Link to={`/upkeep/machines/${peekId}`} className={iconBtn} title={t.open_full_page} aria-label={t.open_full_page}>
              <Maximize2 size={14} />
            </Link>
          </div>
          <div className="p-4">
            <MachineDetail key={peekId} machineId={peekId} compact />
          </div>
        </div>
      )}

      {adding && <MachineForm onClose={() => setAdding(false)} onSaved={(id) => { setClosing(false); setPeekId(id); }} />}
    </div>
  );
}
