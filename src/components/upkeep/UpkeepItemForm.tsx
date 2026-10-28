import { useState } from "react";
import { Button, FormField, Input, Modal, Select } from "../ui";
import { useT } from "../../i18n/useT";
import { useCreateUpkeepItem, useUpdateUpkeepItem } from "../../db/hooks/useUpkeep";
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
      update.mutate({ id: item.id, data: { ...base, ...sched } });
    } else {
      create.mutate({ machine_id: machineId, ...base, ...sched, start_on: startOn });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? t.upkeep_edit_item : t.upkeep_add_item}
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>{t.cancel}</Button>
          <Button onClick={save}>{t.save}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormField label={t.upkeep_item_title} required error={error ?? undefined}>
          <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} autoFocus />
        </FormField>
        {allowUsage && (
          <FormField label={t.upkeep_col_repeats}>
            <Select value={schedule} onChange={(e) => setSchedule(e.target.value as "interval" | "usage")}>
              <option value="interval">{t.upkeep_schedule_interval}</option>
              <option value="usage">{t.upkeep_schedule_usage}</option>
            </Select>
          </FormField>
        )}
        {schedule === "interval" ? (
          <div className="flex gap-2">
            <FormField label={t.upkeep_every}>
              <Input type="number" min={1} value={n} onChange={(e) => setN(e.target.value)} />
            </FormField>
            <FormField label={t.upkeep_unit}>
              <Select value={unit} onChange={(e) => setUnit(e.target.value as IntervalUnit)}>
                {UNITS.map((u) => <option key={u} value={u}>{t[`upkeep_unit_${u}` as const]}</option>)}
              </Select>
            </FormField>
          </div>
        ) : (
          <FormField label={t.upkeep_every_hours}>
            <Input type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} />
          </FormField>
        )}
        {!item && schedule === "interval" && (
          <FormField label={t.upkeep_start_on}>
            <Input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
          </FormField>
        )}
        <FormField label={t.upkeep_notes}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
