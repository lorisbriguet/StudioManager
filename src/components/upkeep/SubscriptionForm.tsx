import { useState } from "react";
import { Button, FormField, Input, Modal, Select } from "../ui";
import { Toggle } from "../ui/Toggle";
import { useT } from "../../i18n/useT";
import { useCreateSubscription, useUpdateSubscription } from "../../db/hooks/useUpkeep";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { confirmIfDirty } from "../../lib/dirty-guard";
import { todayLocalISO } from "../../utils/localDate";
import type { Subscription } from "../../types/upkeep";

interface Props {
  onClose: () => void;
  /** Edit this subscription; add a new one when absent. */
  subscription?: Subscription;
}

/** Add or edit a subscription. Mounted only while open so it starts from fresh state. */
export function SubscriptionForm({ onClose, subscription: s }: Props) {
  const t = useT();
  const create = useCreateSubscription();
  const update = useUpdateSubscription();
  const initial = {
    name: s?.name ?? "",
    plan: s?.plan ?? "",
    vendor: s?.vendor ?? "",
    url: s?.url ?? "",
    renewsOn: s?.renews_on ?? todayLocalISO(),
    period: s?.period ?? "year",
    cost: s ? String(s.cost) : "",
    currency: s?.currency ?? "CHF",
    inCalendar: s ? s.in_calendar === 1 : true,
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof initial>(k: K, v: (typeof initial)[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setError(null);
  };

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChangesWarning(dirty);

  const close = async () => {
    if (dirty && !(await confirmIfDirty())) return;
    onClose();
  };

  const save = () => {
    if (!f.name.trim()) { setError(t.upkeep_name_required); return; }
    if (!f.renewsOn) return;
    const data = {
      name: f.name.trim(),
      plan: f.plan.trim() || null,
      vendor: f.vendor.trim() || null,
      url: f.url.trim() || null,
      renews_on: f.renewsOn,
      period: f.period,
      cost: Math.max(0, Number(f.cost) || 0),
      currency: f.currency.trim() || null,
      in_calendar: f.inCalendar ? 1 : 0,
    };
    if (s) update.mutate({ id: s.id, data });
    else create.mutate(data);
    onClose();
  };

  return (
    <Modal
      open
      onClose={() => void close()}
      title={s ? t.upkeep_edit_subscription : t.upkeep_add_subscription}
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => void close()}>{t.cancel}</Button>
          <Button onClick={save}>{t.save}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormField label={t.name} required error={error ?? undefined}>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </FormField>
        <FormField label={t.upkeep_col_plan}>
          <Input value={f.plan} onChange={(e) => set("plan", e.target.value)} />
        </FormField>
        <FormField label={t.upkeep_sub_vendor}>
          <Input value={f.vendor} onChange={(e) => set("vendor", e.target.value)} />
        </FormField>
        <div className="flex gap-2">
          <FormField label={t.upkeep_sub_renews_on}>
            <Input type="date" value={f.renewsOn} onChange={(e) => set("renewsOn", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_col_period}>
            <Select value={f.period} onChange={(e) => set("period", e.target.value as "month" | "year")}>
              <option value="month">{t.upkeep_period_month}</option>
              <option value="year">{t.upkeep_period_year}</option>
            </Select>
          </FormField>
        </div>
        <div className="flex gap-2">
          <FormField label={t.upkeep_col_cost}>
            <Input type="number" min={0} step="any" value={f.cost} onChange={(e) => set("cost", e.target.value)} />
          </FormField>
          <FormField label={t.currency}>
            <Input value={f.currency} onChange={(e) => set("currency", e.target.value)} />
          </FormField>
        </div>
        <FormField label={t.upkeep_sub_url}>
          <Input value={f.url} placeholder="https://" onChange={(e) => set("url", e.target.value)} />
        </FormField>
        <div className="flex items-center gap-2 text-sm">
          <Toggle checked={f.inCalendar} onChange={(v) => set("inCalendar", v)} ariaLabel={t.upkeep_in_calendar} />
          <span>{t.upkeep_in_calendar}</span>
        </div>
      </div>
    </Modal>
  );
}
