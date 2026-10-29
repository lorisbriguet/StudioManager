import { useState } from "react";
import { FormField, FormGrid, FormModal, Input, Select } from "../ui";
import { useT } from "../../i18n/useT";
import { useCreateConsumable, useMachines, useUpdateConsumable } from "../../db/hooks/useUpkeep";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { confirmIfDirty } from "../../lib/dirty-guard";
import type { Consumable } from "../../types/upkeep";

interface Props {
  onClose: () => void;
  /** Edit this consumable; add a new one when absent. */
  consumable?: Consumable;
}

const num = (v: number | null | undefined) => (v == null ? "" : String(v));
const optNum = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** Add or edit a consumable. Mounted only while open so it starts from fresh state. */
export function ConsumableForm({ onClose, consumable }: Props) {
  const t = useT();
  const create = useCreateConsumable();
  const update = useUpdateConsumable();
  const { data: machines = [] } = useMachines();
  const initial = {
    name: consumable?.name ?? "",
    unit: consumable?.unit ?? "",
    machine: num(consumable?.machine_id),
    stock: num(consumable?.stock ?? 0),
    reorder: num(consumable?.reorder_level ?? 0),
    supplier: consumable?.supplier ?? "",
    url: consumable?.product_url ?? "",
    price: num(consumable?.unit_price),
    currency: consumable?.currency ?? "CHF",
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof initial) => (v: string) => { setF((p) => ({ ...p, [k]: v })); setError(null); };

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChangesWarning(dirty);

  const close = async () => {
    if (dirty && !(await confirmIfDirty())) return;
    onClose();
  };

  const save = () => {
    if (!f.name.trim()) { setError(t.upkeep_name_required); return; }
    const price = optNum(f.price);
    const data = {
      name: f.name.trim(),
      unit: f.unit.trim() || "pcs",
      machine_id: f.machine ? Number(f.machine) : null,
      stock: Math.max(0, optNum(f.stock) ?? 0),
      reorder_level: Math.max(0, optNum(f.reorder) ?? 0),
      supplier: f.supplier.trim() || null,
      product_url: f.url.trim() || null,
      unit_price: price,
      currency: price == null ? null : f.currency.trim() || null,
    };
    if (consumable) update.mutate({ id: consumable.id, data });
    else create.mutate(data);
    onClose();
  };

  return (
    <FormModal
      open
      onClose={() => void close()}
      title={consumable ? t.upkeep_edit_consumable : t.upkeep_add_consumable}
      submitLabel={t.save}
      onSubmit={save}
    >
      <FormGrid cols={3}>
        <FormField label={t.name} required error={error ?? undefined} span="full">
          <Input value={f.name} onChange={(e) => set("name")(e.target.value)} autoFocus />
        </FormField>
        <FormField label={t.upkeep_stock}>
          <Input type="number" min={0} step="any" numeric value={f.stock} onChange={(e) => set("stock")(e.target.value)} />
        </FormField>
        <FormField label={t.unit}>
          <Input value={f.unit} placeholder="pcs" onChange={(e) => set("unit")(e.target.value)} />
        </FormField>
        <FormField label={t.upkeep_reorder_level}>
          <Input type="number" min={0} step="any" numeric value={f.reorder} onChange={(e) => set("reorder")(e.target.value)} />
        </FormField>
        <FormField label={t.upkeep_col_for} span="full">
          <Select value={f.machine} onChange={(e) => set("machine")(e.target.value)}>
            <option value="">{t.upkeep_any_machine}</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t.upkeep_col_supplier} span="full">
          <Input value={f.supplier} onChange={(e) => set("supplier")(e.target.value)} />
        </FormField>
        <FormField label={t.upkeep_product_url} span="full">
          <Input value={f.url} placeholder="https://" onChange={(e) => set("url")(e.target.value)} />
        </FormField>
        <FormField label={t.upkeep_unit_price} span={2}>
          <Input type="number" min={0} step="any" numeric value={f.price} onChange={(e) => set("price")(e.target.value)} />
        </FormField>
        <FormField label={t.currency}>
          <Input value={f.currency} onChange={(e) => set("currency")(e.target.value)} />
        </FormField>
      </FormGrid>
    </FormModal>
  );
}
