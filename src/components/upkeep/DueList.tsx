import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock } from "lucide-react";
import { Badge } from "../ui";
import { useT } from "../../i18n/useT";
import { useMarkUpkeepDone, useSnoozeUpkeep } from "../../db/hooks/useUpkeep";
import { dueStateVariant } from "../../lib/statusColors";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import type { DueRow } from "../../lib/upkeep/overview";
import type { UpkeepItem } from "../../types/upkeep";

type T = ReturnType<typeof useT>;

function repeatsLabel(item: UpkeepItem, t: T): string {
  if (item.schedule === "usage") {
    return t.upkeep_repeats_usage.replace("{n}", String(item.usage_every ?? ""));
  }
  const n = item.interval_n ?? 1;
  const unit = item.interval_unit ?? "month";
  const key = `upkeep_repeats_${unit}_${n === 1 ? "one" : "many"}` as keyof T;
  return String(t[key]).replace("{n}", String(n));
}

const SNOOZE_CHOICES = [1, 3, 7] as const;

function SnoozeMenu({ onPick }: { onPick: (days: 1 | 3 | 7) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labels = { 1: t.upkeep_snooze_1, 3: t.upkeep_snooze_3, 7: t.upkeep_snooze_7 };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t.upkeep_snooze}
        title={t.upkeep_snooze}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded-md text-muted hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors"
      >
        <Clock size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 min-w-[120px] rounded-lg border border-[var(--color-input-border)] bg-[var(--color-surface)] py-1 shadow-lg"
        >
          {SNOOZE_CHOICES.map((d) => (
            <button
              key={d}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onPick(d); }}
              className="block w-full text-left px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
            >
              {labels[d]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Overdue and soon-due upkeep, with mark-done and snooze. Reused by the dashboard widget. */
export function DueList({ rows, compact = false }: { rows: DueRow[]; compact?: boolean }) {
  const t = useT();
  const markDone = useMarkUpkeepDone();
  const snooze = useSnoozeUpkeep();

  const cell = compact ? "px-3 py-2" : "px-4 py-2.5";
  const head = `${cell} text-left text-xs font-normal text-muted border-b border-[var(--color-border-header)] whitespace-nowrap`;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className={head}>{t.upkeep_col_task}</th>
          <th className={head}>{t.upkeep_col_machine}</th>
          {!compact && <th className={head}>{t.upkeep_col_repeats}</th>}
          <th className={head}>{t.upkeep_col_due}</th>
          <th className={head}>{t.upkeep_col_status}</th>
          <th className={head} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.item.id}
            className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors"
          >
            <td className={`${cell} font-medium`}>{r.item.title}</td>
            <td className={`${cell} text-muted`}>
              <Link to={`/upkeep/machines/${r.machine.id}`} className="hover:text-accent">
                {r.machine.name}
              </Link>
            </td>
            {!compact && <td className={`${cell} text-muted`}>{repeatsLabel(r.item, t)}</td>}
            <td className={`${cell} tabular-nums`}>{r.due ? formatDisplayDate(r.due) : ""}</td>
            <td className={cell}>
              <Badge variant={dueStateVariant(r.state)}>
                {r.state === "overdue" ? t.overdue : t.upkeep_status_soon}
              </Badge>
            </td>
            <td className={cell}>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  aria-label={t.upkeep_mark_done}
                  title={t.upkeep_mark_done}
                  onClick={() =>
                    markDone.mutate({ id: r.item.id, doneOn: todayLocalISO(), reading: null })
                  }
                  className="p-1 rounded-md text-muted hover:text-[var(--color-success-text)] hover:bg-[var(--color-hover-row)] transition-colors"
                >
                  <Check size={16} />
                </button>
                <SnoozeMenu
                  onPick={(days) => snooze.mutate({ id: r.item.id, days, todayISO: todayLocalISO() })}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
