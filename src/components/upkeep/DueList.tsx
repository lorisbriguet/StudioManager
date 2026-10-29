import { Link } from "react-router-dom";
import { Badge, Dropdown, ICONS, IconButton, Table } from "../ui";
import { useT } from "../../i18n/useT";
import { useMarkUpkeepDone, useSnoozeUpkeep } from "../../db/hooks/useUpkeep";
import { dueStateVariant } from "../../lib/statusColors";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import type { DueRow } from "../../lib/upkeep/overview";
import type { UpkeepItem } from "../../types/upkeep";

type T = ReturnType<typeof useT>;

export function repeatsLabel(item: UpkeepItem, t: T): string {
  if (item.schedule === "usage") {
    return t.upkeep_repeats_usage.replace("{n}", String(item.usage_every ?? ""));
  }
  const n = item.interval_n ?? 1;
  const unit = item.interval_unit ?? "month";
  const key = `upkeep_repeats_${unit}_${n === 1 ? "one" : "many"}` as keyof T;
  return String(t[key]).replace("{n}", String(n));
}

const SNOOZE_CHOICES = [1, 3, 7] as const;

/** Overdue and soon-due upkeep, with mark-done and snooze. Reused by the dashboard widget. */
export function DueList({ rows, compact = false }: { rows: DueRow[]; compact?: boolean }) {
  const t = useT();
  const markDone = useMarkUpkeepDone();
  const snooze = useSnoozeUpkeep();
  const snoozeLabels = { 1: t.upkeep_snooze_1, 3: t.upkeep_snooze_3, 7: t.upkeep_snooze_7 };

  return (
    <Table density={compact ? "compact" : "default"}>
      <Table.Head>
        <Table.Th>{t.upkeep_col_task}</Table.Th>
        <Table.Th>{t.upkeep_col_machine}</Table.Th>
        {!compact && <Table.Th>{t.upkeep_col_repeats}</Table.Th>}
        <Table.Th>{t.upkeep_col_due}</Table.Th>
        <Table.Th>{t.upkeep_col_status}</Table.Th>
        <Table.ActionsTh />
      </Table.Head>
      <Table.Body>
        {rows.map((r) => (
          <Table.Row key={r.item.id}>
            <Table.Td className="font-medium">{r.item.title}</Table.Td>
            <Table.Td muted>
              <Link to={`/upkeep/machines/${r.machine.id}`} className="hover:text-accent-text">
                {r.machine.name}
              </Link>
            </Table.Td>
            {!compact && <Table.Td muted>{repeatsLabel(r.item, t)}</Table.Td>}
            <Table.Td className="tabular-nums">{r.due ? formatDisplayDate(r.due) : ""}</Table.Td>
            <Table.Td>
              <Badge variant={dueStateVariant(r.state)}>
                {r.state === "overdue" ? t.overdue : t.upkeep_status_soon}
              </Badge>
            </Table.Td>
            <Table.Actions always>
              <IconButton
                size="xs"
                icon={ICONS.markDone}
                label={t.upkeep_mark_done}
                onClick={() => markDone.mutate({ id: r.item.id, doneOn: todayLocalISO(), reading: null })}
              />
              <Dropdown
                align="end"
                trigger={<IconButton size="xs" icon={ICONS.time} label={t.upkeep_snooze} />}
                items={SNOOZE_CHOICES.map((days) => ({
                  label: snoozeLabels[days],
                  onSelect: () => snooze.mutate({ id: r.item.id, days, todayISO: todayLocalISO() }),
                }))}
              />
            </Table.Actions>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
