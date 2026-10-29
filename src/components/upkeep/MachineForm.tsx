import { useMemo, useState } from "react";
import { ImagePlus } from "lucide-react";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import {
  Button, Card, Checkbox, DatePicker, FIELD_LABEL, FormField, FormGrid, FormGridItem, FormGroup, FormModal, ICONS,
  IconButton, Input, Select,
} from "../ui";
import { useT } from "../../i18n/useT";
import { useCreateMachine, useUpdateMachine } from "../../db/hooks/useUpkeep";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { confirmIfDirty } from "../../lib/dirty-guard";
import { sanitizeSegment } from "../../lib/attachReceipt";
import { notify } from "../../lib/notify";
import { orgPaths } from "../../lib/orgPaths";
import { MACHINE_TEMPLATES, templateByKey } from "../../lib/upkeep/templates";
import type { IntervalUnit, Machine, MachineInput, MachineTemplateItemInput } from "../../types/upkeep";

const UNITS: IntervalUnit[] = ["day", "week", "month", "year"];

interface ItemRow {
  on: boolean;
  title: string;
  schedule: "interval" | "usage";
  n: string;
  unit: IntervalUnit;
  every: string;
}

interface Props {
  onClose: () => void;
  /** Edit this machine; create a new one when absent. */
  machine?: Machine;
  onSaved?: (id: number) => void;
}

const num = (s: string): number | null => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

/** Copy a picked photo into the org's data folder, like attached files. */
async function copyPhoto(src: string): Promise<string> {
  const { root } = await orgPaths();
  const dir = `${root}/machines/photos`;
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  const dest = `${dir}/${Date.now()}_${sanitizeSegment(src.split("/").pop() ?? "photo")}`;
  await copyFile(src, dest);
  return dest;
}

/** Add or edit a machine. Mounted only while open. */
export function MachineForm({ onClose, machine, onSaved }: Props) {
  const t = useT();
  const create = useCreateMachine();
  const update = useUpdateMachine();

  const initial = useMemo(
    () => ({
      template: machine?.template_key ?? "",
      name: machine?.name ?? "",
      kind: machine?.kind ?? "",
      maker: machine?.maker ?? "",
      model: machine?.model ?? "",
      serial: machine?.serial ?? "",
      location: machine?.location ?? "",
      purchase_date: machine?.purchase_date ?? "",
      supplier: machine?.supplier ?? "",
      price: machine?.price != null ? String(machine.price) : "",
      warranty_until: machine?.warranty_until ?? "",
      lifespan: machine?.lifespan_years != null ? String(machine.lifespan_years) : "",
      notes: machine?.notes ?? "",
    }),
    [machine]
  );
  const [f, setF] = useState(initial);
  const [photo, setPhoto] = useState<string | null>(machine?.photo_path ?? null);
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const dirty =
    JSON.stringify(f) !== JSON.stringify(initial) ||
    photo !== (machine?.photo_path ?? null) ||
    rows.some((r) => !r.on) ||
    (!machine && rows.length > 0);
  useUnsavedChangesWarning(dirty);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const pickTemplate = (key: string) => {
    const tpl = templateByKey(key);
    setF((p) => {
      const prevName = templateByKey(p.template) ? t[templateByKey(p.template)!.nameKey] : "";
      const kind = !p.kind || p.kind === prevName ? (tpl ? t[tpl.nameKey] : "") : p.kind;
      return { ...p, template: key, kind };
    });
    setRows(
      (tpl?.items ?? []).map((it) => ({
        on: true,
        title: t[it.titleKey],
        schedule: it.schedule,
        n: String(it.interval_n ?? 1),
        unit: it.interval_unit ?? "month",
        every: String(it.usage_every ?? 100),
      }))
    );
  };

  const setRow = (i: number, patch: Partial<ItemRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const close = async () => {
    if (dirty && !(await confirmIfDirty())) return;
    onClose();
  };

  const choosePhoto = async () => {
    try {
      const picked = await pickFile({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "heic"] }],
      });
      if (typeof picked === "string") { setPhoto(picked); setPhotoSource(picked); }
    } catch (e) {
      notify.error(t.upkeep_photo_failed, e);
    }
  };

  const save = async () => {
    if (!f.name.trim()) { setNameError(t.upkeep_name_required); return; }
    setSaving(true);
    try {
      let photo_path = photo;
      if (photoSource && photo === photoSource) photo_path = await copyPhoto(photoSource);
      const data: MachineInput = {
        name: f.name.trim(),
        kind: f.kind.trim() || (templateByKey(f.template) ? t[templateByKey(f.template)!.nameKey] : ""),
        maker: f.maker.trim() || null,
        model: f.model.trim() || null,
        serial: f.serial.trim() || null,
        location: f.location.trim() || null,
        purchase_date: f.purchase_date || null,
        supplier: f.supplier.trim() || null,
        price: num(f.price),
        warranty_until: f.warranty_until || null,
        lifespan_years: num(f.lifespan),
        notes: f.notes.trim() || null,
        photo_path,
        template_key: f.template || null,
      };
      if (machine) {
        update.mutate({ id: machine.id, data }, { onSuccess: () => onSaved?.(machine.id) });
        onClose();
      } else {
        const items: MachineTemplateItemInput[] = rows
          .filter((r) => r.on && r.title.trim())
          .map((r) =>
            r.schedule === "interval"
              ? {
                  title: r.title.trim(), schedule: "interval" as const,
                  interval_n: Math.max(1, Math.round(num(r.n) ?? 1)), interval_unit: r.unit,
                }
              : {
                  title: r.title.trim(), schedule: "usage" as const,
                  usage_metric: "print_hours" as const, usage_every: Math.max(1, num(r.every) ?? 1),
                }
          );
        create.mutate({ data, items }, { onSuccess: (id) => onSaved?.(id) });
        onClose();
      }
    } catch (e) {
      notify.error(t.upkeep_photo_failed, e);
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={() => void close()}
      title={machine ? t.upkeep_edit_machine : t.upkeep_add_machine}
      submitLabel={t.save}
      submitting={saving}
      onSubmit={() => void save()}
    >
      <FormGrid cols={2}>
        {!machine && (
          <FormField label={t.upkeep_template} span="full">
            <Select value={f.template} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">{t.none}</option>
              {MACHINE_TEMPLATES.map((tpl) => (
                <option key={tpl.key} value={tpl.key}>{t[tpl.nameKey]}</option>
              ))}
            </Select>
          </FormField>
        )}
        {rows.length > 0 && (
          <FormGridItem>
          <Card tone="inset" padding="sm" className="space-y-2">
            <div className={FIELD_LABEL}>{t.upkeep_template_items}</div>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Checkbox
                  checked={r.on}
                  aria-label={r.title}
                  onChange={(e) => setRow(i, { on: e.target.checked })}
                />
                <Input value={r.title} aria-label={t.name} onChange={(e) => setRow(i, { title: e.target.value })} />
                {r.schedule === "interval" ? (
                  <>
                    <Input
                      type="number" min={1} width="xs" numeric
                      aria-label={t.upkeep_every}
                      value={r.n} onChange={(e) => setRow(i, { n: e.target.value })}
                    />
                    <Select
                      fullWidth={false} aria-label={t.upkeep_unit} value={r.unit}
                      onChange={(e) => setRow(i, { unit: e.target.value as IntervalUnit })}
                    >
                      {UNITS.map((u) => <option key={u} value={u}>{t[`upkeep_unit_${u}` as const]}</option>)}
                    </Select>
                  </>
                ) : (
                  <>
                    <Input
                      type="number" min={1} width="xs" numeric
                      aria-label={t.upkeep_every_hours}
                      value={r.every} onChange={(e) => setRow(i, { every: e.target.value })}
                    />
                    <span className="text-xs text-muted whitespace-nowrap">{t.upkeep_hours_short}</span>
                  </>
                )}
              </div>
            ))}
          </Card>
          </FormGridItem>
        )}
          <FormField label={t.name} required error={nameError}>
            <Input value={f.name} onChange={(e) => { set("name", e.target.value); setNameError(undefined); }} autoFocus />
          </FormField>
          <FormField label={t.upkeep_kind}>
            <Input value={f.kind} onChange={(e) => set("kind", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_maker}>
            <Input value={f.maker} onChange={(e) => set("maker", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_model}>
            <Input value={f.model} onChange={(e) => set("model", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_serial}>
            <Input value={f.serial} onChange={(e) => set("serial", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_location}>
            <Input value={f.location} onChange={(e) => set("location", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_bought}>
            <DatePicker value={f.purchase_date || null} onChange={(v) => set("purchase_date", v ?? "")} />
          </FormField>
          <FormField label={t.supplier}>
            <Input value={f.supplier} onChange={(e) => set("supplier", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_price}>
            <Input type="number" min={0} step="0.01" numeric value={f.price} onChange={(e) => set("price", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_warranty_until}>
            <DatePicker value={f.warranty_until || null} onChange={(v) => set("warranty_until", v ?? "")} />
          </FormField>
          <FormField label={t.upkeep_lifespan_years}>
            <Input type="number" min={1} numeric value={f.lifespan} onChange={(e) => set("lifespan", e.target.value)} />
          </FormField>
          <FormGroup label={t.upkeep_photo}>
            <div className="flex items-center gap-2">
              <Button variant="secondary" icon={ImagePlus} onClick={() => void choosePhoto()}>
                {photo ? t.upkeep_photo_change : t.upkeep_photo_add}
              </Button>
              {photo && (
                <IconButton
                  icon={ICONS.close}
                  label={t.upkeep_photo_remove}
                  onClick={() => { setPhoto(null); setPhotoSource(null); }}
                />
              )}
            </div>
          </FormGroup>
        <FormField label={t.upkeep_notes} span="full">
          <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
      </FormGrid>
    </FormModal>
  );
}
