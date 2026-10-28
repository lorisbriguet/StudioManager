import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Badge, Button, Card, FormField, Input, Modal, Select } from "../ui";
import { Toggle } from "../ui/Toggle";
import { MachineForm } from "./MachineForm";
import { MachineExpenseRow } from "./MachineExpenseRow";
import { CollapsibleSection } from "./CollapsibleSection";
import { FilesSection, ServiceLogSection } from "./MachineLogSections";
import { UpkeepItemForm } from "./UpkeepItemForm";
import { ReadingsSection } from "./ReadingsSection";
import { repeatsLabel } from "./DueList";
import { useT } from "../../i18n/useT";
import {
  useArchiveUpkeepItem,
  useDeleteMachine,
  useMachine,
  useMachineProjectIds,
  useMarkUpkeepDone,
  useSetMachineProjects,
  useUpdateMachine,
  useUpdateUpkeepItem,
  useUpkeepItems,
} from "../../db/hooks/useUpkeep";
import { useProjects } from "../../db/hooks/useProjects";
import { useAppStore } from "../../stores/app-store";
import { dueStateVariant, machineStatusVariant } from "../../lib/statusColors";
import { dueState, effectiveDue } from "../../lib/upkeep/schedule";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import type { Machine, MachineStatus, UpkeepItem } from "../../types/upkeep";

const STATUSES: MachineStatus[] = ["working", "attention", "broken", "lent", "retired"];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted mb-0.5">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

const iconBtn =
  "p-1 rounded-md text-muted hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors";

function MachinePhoto({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    readFile(path)
      .then((bytes) => { url = URL.createObjectURL(new Blob([bytes])); setSrc(url); })
      .catch(() => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (!src) return null;
  return <img src={src} alt="" className="h-16 w-16 rounded-lg object-cover shrink-0" />;
}

function LentDialog({ machine, onCancel, onSave }: {
  machine: Machine;
  onCancel: () => void;
  onSave: (to: string, until: string | null) => void;
}) {
  const t = useT();
  const [to, setTo] = useState(machine.lent_to ?? "");
  const [until, setUntil] = useState(machine.lent_until ?? "");
  const [error, setError] = useState<string>();
  const save = () => {
    if (!to.trim()) { setError(t.upkeep_lent_to_required); return; }
    onSave(to.trim(), until || null);
  };
  return (
    <Modal
      open
      onClose={onCancel}
      title={t.machine_status_lent}
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel}>{t.cancel}</Button>
          <Button onClick={save}>{t.save}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormField label={t.upkeep_lent_to} required error={error}>
          <Input value={to} autoFocus onChange={(e) => { setTo(e.target.value); setError(undefined); }} />
        </FormField>
        <FormField label={t.upkeep_lent_until}>
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

function ProjectsSection({ machineId }: { machineId: number }) {
  const t = useT();
  const { data: ids = [] } = useMachineProjectIds(machineId);
  const { data: projects = [] } = useProjects();
  const setProjects = useSetMachineProjects();
  const linked = projects.filter((p) => ids.includes(p.id));
  const rest = projects.filter((p) => !ids.includes(p.id));
  return (
    <CollapsibleSection id={`machine-${machineId}-projects`} title={t.upkeep_linked_projects}>
      <div className="flex flex-wrap items-center gap-2">
        {linked.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-input-bg)] px-2.5 py-0.5 text-xs">
            {p.name}
            <button
              type="button"
              aria-label={`${t.upkeep_unlink_project} ${p.name}`}
              className="text-muted hover:text-[var(--color-text-secondary)]"
              onClick={() => setProjects.mutate({ id: machineId, projectIds: ids.filter((i) => i !== p.id) })}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {rest.length > 0 && (
          <Select
            fullWidth={false}
            aria-label={t.upkeep_link_project}
            value=""
            onChange={(e) => {
              if (e.target.value) setProjects.mutate({ id: machineId, projectIds: [...ids, Number(e.target.value)] });
            }}
          >
            <option value="">{t.upkeep_link_project}</option>
            {rest.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        {linked.length === 0 && rest.length === 0 && <span className="text-sm text-muted">{t.none}</span>}
      </div>
    </CollapsibleSection>
  );
}

/** Full machine detail; used by the peek panel (`compact`) and the machine page. */
export function MachineDetail({ machineId, compact = false, onDeleted }: {
  machineId: number;
  compact?: boolean;
  onDeleted?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { data: machine } = useMachine(machineId);
  const { data: items = [] } = useUpkeepItems(machineId);
  const updateMachine = useUpdateMachine();
  const deleteMachine = useDeleteMachine();
  const updateItem = useUpdateUpkeepItem();
  const archiveItem = useArchiveUpkeepItem();
  const markDone = useMarkUpkeepDone();
  const soonDays = useAppStore((s) => s.upkeepSoonDays);

  const [status, setStatus] = useState<MachineStatus>(machine?.status ?? "working");
  const [askLent, setAskLent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [itemForm, setItemForm] = useState<{ item?: UpkeepItem } | null>(null);
  const [yearDraft, setYearDraft] = useState<string | null>(null);

  useEffect(() => { if (machine) setStatus(machine.status); }, [machine?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!machine) return null;
  const today = todayLocalISO();
  const active = items.filter((i) => !i.archived);
  const boughtYear = machine.purchase_date ? Number(machine.purchase_date.slice(0, 4)) : null;
  const replaceYear = boughtYear != null && machine.lifespan_years != null
    ? boughtYear + Math.ceil(machine.lifespan_years) : null;
  const sub = [machine.kind, machine.location].filter(Boolean).join(" · ");

  const onStatus = (next: MachineStatus) => {
    setStatus(next);
    if (next === "lent") { setAskLent(true); return; }
    updateMachine.mutate({ id: machine.id, data: { status: next } });
  };

  const commitYear = () => {
    if (yearDraft == null || boughtYear == null) return;
    const years = Math.round(Number(yearDraft)) - boughtYear;
    setYearDraft(null);
    if (years >= 1 && years !== machine.lifespan_years) {
      updateMachine.mutate({ id: machine.id, data: { lifespan_years: years } });
    }
  };

  const remove = async () => {
    if (!(await ask(t.upkeep_delete_machine_confirm, { kind: "warning" }))) return;
    deleteMachine.mutate(machine.id, {
      onSuccess: () => { onDeleted?.(); navigate("/upkeep?tab=machines"); },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {machine.photo_path && <MachinePhoto path={machine.photo_path} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold truncate">{machine.name}</h2>
          {sub && <div className="text-sm text-muted truncate">{sub}</div>}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} aria-label={t.edit} title={t.edit} onClick={() => setEditing(true)}>
            <Pencil size={16} />
          </button>
          <button type="button" className={iconBtn} aria-label={t.delete} title={t.delete} onClick={() => void remove()}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant={machineStatusVariant(status)}>{t[`machine_status_${status}` as const]}</Badge>
        <Select fullWidth={false} aria-label={t.upkeep_col_status} value={status} onChange={(e) => onStatus(e.target.value as MachineStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t[`machine_status_${s}` as const]}</option>)}
        </Select>
        {status === "lent" && machine.lent_to && (
          <span className="text-xs text-muted">
            {machine.lent_to}{machine.lent_until ? ` · ${formatDisplayDate(machine.lent_until)}` : ""}
          </span>
        )}
      </div>
      {status === "retired" && <p className="text-sm text-muted">{t.upkeep_retired_note}</p>}

      <CollapsibleSection id={`machine-${machine.id}-facts`} title={t.upkeep_details}>
      <Card>
        <div className={`grid gap-4 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
          <Fact label={t.upkeep_bought}>
            {machine.purchase_date ? formatDisplayDate(machine.purchase_date) : "—"}
            {machine.supplier && <span className="text-muted"> · {machine.supplier}</span>}
          </Fact>
          <Fact label={t.upkeep_price}><MachineExpenseRow machine={machine} /></Fact>
          <Fact label={t.upkeep_serial}>{machine.serial ?? "—"}</Fact>
          <Fact label={t.upkeep_warranty_until}>{machine.warranty_until ? formatDisplayDate(machine.warranty_until) : "—"}</Fact>
          <Fact label={t.upkeep_replace_around_label}>
            <Input
              type="number"
              fullWidth={false}
              className="w-24"
              aria-label={t.upkeep_replace_around_label}
              disabled={boughtYear == null}
              value={yearDraft ?? (replaceYear ?? "")}
              onChange={(e) => setYearDraft(e.target.value)}
              onBlur={commitYear}
              onKeyDown={(e) => { if (e.key === "Enter") commitYear(); }}
            />
          </Fact>
        </div>
      </Card>
      </CollapsibleSection>

      <CollapsibleSection
        id={`machine-${machine.id}-schedule`}
        title={t.upkeep_schedule}
        aside={
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setItemForm({})}>
            {t.upkeep_add_item}
          </Button>
        }
      >
        {active.length === 0 ? (
          <p className="text-sm text-muted">{t.upkeep_schedule_empty}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {active.map((it) => {
                const state = dueState(it, today, soonDays);
                const due = effectiveDue(it);
                return (
                  <tr key={it.id} className="border-b border-[var(--color-border-divider)]">
                    <td className="px-2 py-2 font-medium">{it.title}</td>
                    <td className="px-2 py-2 text-muted">{repeatsLabel(it, t)}</td>
                    <td className="px-2 py-2 tabular-nums whitespace-nowrap">{due ? formatDisplayDate(due) : ""}</td>
                    <td className="px-2 py-2">
                      {(state === "overdue" || state === "soon") && (
                        <Badge variant={dueStateVariant(state)}>
                          {state === "overdue" ? t.overdue : t.upkeep_status_soon}
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2 text-xs text-muted whitespace-nowrap">
                        {t.upkeep_in_calendar}
                        <Toggle
                          checked={it.in_calendar === 1}
                          ariaLabel={t.upkeep_in_calendar}
                          onChange={(on) => updateItem.mutate({ id: it.id, data: { in_calendar: on ? 1 : 0 } })}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className={iconBtn} aria-label={t.upkeep_mark_done} title={t.upkeep_mark_done}
                          onClick={() => markDone.mutate({ id: it.id, doneOn: today, reading: null })}>
                          <Check size={16} />
                        </button>
                        <button type="button" className={iconBtn} aria-label={t.edit} title={t.edit} onClick={() => setItemForm({ item: it })}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className={iconBtn} aria-label={t.upkeep_archive} title={t.upkeep_archive}
                          onClick={() => archiveItem.mutate(it.id)}>
                          <Archive size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CollapsibleSection>

      <CollapsibleSection id={`machine-${machine.id}-readings`} title={t.upkeep_readings}>
        <ReadingsSection machine={machine} items={active} />
      </CollapsibleSection>

      <FilesSection machineId={machine.id} />
      <ServiceLogSection machineId={machine.id} />
      <ProjectsSection machineId={machine.id} />

      {askLent && (
        <LentDialog
          machine={machine}
          onCancel={() => { setAskLent(false); setStatus(machine.status); }}
          onSave={(to, until) => {
            updateMachine.mutate({ id: machine.id, data: { status: "lent", lent_to: to, lent_until: until } });
            setAskLent(false);
          }}
        />
      )}
      {editing && <MachineForm machine={machine} onClose={() => setEditing(false)} />}
      {itemForm && (
        <UpkeepItemForm
          open
          onClose={() => setItemForm(null)}
          machineId={machine.id}
          item={itemForm.item}
          allowUsage={machine.template_key === "printer_3d" || machine.connection_id != null || itemForm.item?.schedule === "usage"}
        />
      )}
    </div>
  );
}
