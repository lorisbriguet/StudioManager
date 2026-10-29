import { useState } from "react";
import { DatePicker, FormField, FormGrid, FormModal, Input, Select } from "../ui";
import { useT } from "../../i18n/useT";
import { useCreateUpkeepItem, useUpdateUpkeepItem } from "../../db/hooks/useUpkeep";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { confirmIfDirty } from "../../lib/dirty-guard";
import { todayLocalISO } from "../../utils/localDate";
import type { IntervalUnit, UpkeepItem } from "../../types/upkeep";

const UNITS: IntervalUnit[] = ["day", "week", "month", "year"];

interface Props {
  open: boolean;
  onClose: () => void;
  machineId: number;
  /** Edit this item; add a new one when absent. */
  item?: UpkeepItem;
  /** Usage schedules (print hours) only make sense for machines that count them. */
  allowUsage: boolean;
}

/** Add or edit one upkeep item. Mounted only while open so it starts from fresh state. */
export function UpkeepItemForm({ open, onClose, machineId, item, allowUsage }: Props) {
  const t = useT();
  const create = useCreateUpkeepItem();
  const update = useUpdateUpkeepItem();
  const [title, setTitle] = useState(item?.title ?? "");
  const [schedule, setSchedule] = useState<"interval" | "usage">(item?.schedule ?? "interval");
  const [n, setN] = useState(String(item?.interval_n ?? 1));
  const [unit, setUnit] = useState<IntervalUnit>(item?.interval_unit ?? "month");
  const [every, setEvery] = useState(String(item?.usage_every ?? 100));
  const [startOn, setStartOn] = useState(todayLocalISO());
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title !== (item?.title ?? "") ||
    schedule !== (item?.schedule ?? "interval") ||
    n !== String(item?.interval_n ?? 1) ||
    unit !== (item?.interval_unit ?? "month") ||
    every !== String(item?.usage_every ?? 100) ||
    notes !== (item?.notes ?? "");
  useUnsavedChangesWarning(dirty);

  const close = async () => {
    if (dirty && !(await confirmIfDirty())) return;
    onClose();
  };

  const save = () => {
    if (!title.trim()) { setError(t.upkeep_title_required); return; }
    const base = { title: title.trim(), notes: notes.trim() || null, schedule };
    const sched =
      schedule === "interval"
        ? {
            interval_n: Math.max(1, Math.round(Number(n) || 1)),
            interval_unit: unit,
            usage_metric: null, usage_every: null,
          }
        : {
            interval_n: null, interval_unit: null,
            usage_metric: "print_hours" as const,
            usage_every: Math.max(1, Number(every) || 1),
          };
    if (item) {
      // Only what changed: resending an unchanged schedule must not move the due date.
      const row = item as unknown as Record<string, unknown>;
      const changed = Object.fromEntries(
        Object.entries({ ...base, ...sched }).filter(([k, v]) => v !== row[k])
      );
      if (Object.keys(changed).length > 0) update.mutate({ id: item.id, data: changed });
    } else {
      create.mutate({ machine_id: machineId, ...base, ...sched, start_on: startOn });
    }
    onClose();
  };

  return (
    <FormModal
      open={open}
      onClose={() => void close()}
      title={item ? t.upkeep_edit_item : t.upkeep_add_item}
      submitLabel={t.save}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <FormField label={t.upkeep_item_title} required error={error ?? undefined} span="full">
          <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} autoFocus />
        </FormField>
        {allowUsage && (
          <FormField label={t.upkeep_col_repeats} span="full">
            <Select value={schedule} onChange={(e) => setSchedule(e.target.value as "interval" | "usage")}>
              <option value="interval">{t.upkeep_schedule_interval}</option>
              <option value="usage">{t.upkeep_schedule_usage}</option>
            </Select>
          </FormField>
        )}
        {schedule === "interval" ? (
          <>
            <FormField label={t.upkeep_every}>
              <Input type="number" min={1} numeric value={n} onChange={(e) => setN(e.target.value)} />
            </FormField>
            <FormField label={t.upkeep_unit}>
              <Select value={unit} onChange={(e) => setUnit(e.target.value as IntervalUnit)}>
                {UNITS.map((u) => <option key={u} value={u}>{t[`upkeep_unit_${u}` as const]}</option>)}
              </Select>
            </FormField>
          </>
        ) : (
          <FormField label={t.upkeep_every_hours} span="full">
            <Input type="number" min={1} numeric value={every} onChange={(e) => setEvery(e.target.value)} />
          </FormField>
        )}
        {!item && schedule === "interval" && (
          <FormField label={t.upkeep_start_on} span="full">
            <DatePicker value={startOn} onChange={(v) => setStartOn(v ?? todayLocalISO())} />
          </FormField>
        )}
        <FormField label={t.upkeep_notes} span="full">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </FormGrid>
    </FormModal>
  );
}
