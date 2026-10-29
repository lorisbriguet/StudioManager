import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive } from "lucide-react";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  Badge, Button, Card, DatePicker, EmptyState, FIELD_LABEL, FormField, FormGrid, FormModal, ICONS, IconButton,
  Input, PageHeader, PanelTitle, Select, Table, Tag, Toggle,
} from "../ui";
import { MachineForm } from "./MachineForm";
import { MachineExpenseRow } from "./MachineExpenseRow";
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
import { useConfirm } from "../../lib/confirm";
import type { Machine, MachineStatus, UpkeepItem } from "../../types/upkeep";

const STATUSES: MachineStatus[] = ["working", "attention", "broken", "lent", "retired"];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`${FIELD_LABEL} mb-0.5`}>{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

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
  return <img src={src} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0" />;
}

function LentDialog({ machine, onCancel, onSave }: {
  machine: Machine;
  onCancel: () => void;
  onSave: (to: string, until: string | null) => void;
}) {
  const t = useT();
  const [to, setTo] = useState(machine.lent_to ?? "");
  const [until, setUntil] = useState<string | null>(machine.lent_until ?? null);
  const [error, setError] = useState<string>();
  const save = () => {
    if (!to.trim()) { setError(t.upkeep_lent_to_required); return; }
    onSave(to.trim(), until || null);
  };
  return (
    <FormModal open size="sm" onClose={onCancel} title={t.machine_status_lent} submitLabel={t.save} onSubmit={save}>
      <FormGrid cols={1}>
        <FormField label={t.upkeep_lent_to} required error={error}>
          <Input value={to} autoFocus onChange={(e) => { setTo(e.target.value); setError(undefined); }} />
        </FormField>
        <FormField label={t.upkeep_lent_until}>
          <DatePicker value={until} onChange={setUntil} />
        </FormField>
      </FormGrid>
    </FormModal>
  );
}

function ProjectsSection({ machineId, headingAs }: { machineId: number; headingAs: "h2" | "h3" }) {
  const t = useT();
  const { data: ids = [] } = useMachineProjectIds(machineId);
  const { data: projects = [] } = useProjects();
  const setProjects = useSetMachineProjects();
  const linked = projects.filter((p) => ids.includes(p.id));
  const rest = projects.filter((p) => !ids.includes(p.id));
  return (
    <section>
      <PanelTitle as={headingAs} title={t.upkeep_linked_projects} className="mb-3" />
      <div className="flex flex-wrap items-center gap-2">
        {linked.map((p) => (
          <Tag
            key={p.id}
            name={p.name}
            color="gray"
            onRemove={() => setProjects.mutate({ id: machineId, projectIds: ids.filter((i) => i !== p.id) })}
          />
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
    </section>
  );
}

/**
 * Full machine detail; used by the peek panel (`compact`: the title is an h2,
 * the host page owns the h1) and the machine page (`onBack`: the page's h1
 * with its back button).
 */
export function MachineDetail({ machineId, compact = false, onDeleted, onBack }: {
  machineId: number;
  compact?: boolean;
  onDeleted?: () => void;
  onBack?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const h = compact ? "h3" : "h2";
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
    if (!(await confirm({ title: t.upkeep_delete_machine_confirm, confirmLabel: t.delete, tone: "danger" }))) return;
    deleteMachine.mutate(machine.id, {
      onSuccess: () => { onDeleted?.(); navigate("/upkeep?tab=machines"); },
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        as={compact ? "h2" : "h1"}
        className="mb-0!"
        title={machine.name}
        meta={sub || undefined}
        back={onBack}
        leading={machine.photo_path ? <MachinePhoto path={machine.photo_path} /> : undefined}
        actions={<>
          <IconButton icon={ICONS.edit} label={t.edit} onClick={() => setEditing(true)} />
          <IconButton icon={ICONS.delete} label={t.delete} tone="danger" onClick={() => void remove()} />
        </>}
      />

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

      <section>
        <PanelTitle as={h} title={t.upkeep_details} className="mb-3" />
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
              width="sm"
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
      </section>

      <section>
        <PanelTitle
          as={h}
          title={t.upkeep_schedule}
          className="mb-3"
          action={
            <Button variant="secondary" icon={ICONS.add} onClick={() => setItemForm({})}>
              {t.upkeep_add_item}
            </Button>
          }
        />
        {active.length === 0 ? (
          <EmptyState size="sm" message={t.upkeep_schedule_empty} />
        ) : (
          <Table density="compact">
            <Table.Body>
              {active.map((it) => {
                const state = dueState(it, today, soonDays);
                const due = effectiveDue(it);
                return (
                  <Table.Row key={it.id}>
                    <Table.Td className="font-medium">{it.title}</Table.Td>
                    <Table.Td muted>{repeatsLabel(it, t)}</Table.Td>
                    <Table.Td className="tabular-nums whitespace-nowrap">{due ? formatDisplayDate(due) : ""}</Table.Td>
                    <Table.Td>
                      {(state === "overdue" || state === "soon") && (
                        <Badge variant={dueStateVariant(state)}>
                          {state === "overdue" ? t.overdue : t.upkeep_status_soon}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap">
                      <Toggle
                        size="sm"
                        checked={it.in_calendar === 1}
                        label={<span className="text-xs text-muted">{t.upkeep_in_calendar}</span>}
                        ariaLabel={t.upkeep_in_calendar}
                        onChange={(on) => updateItem.mutate({ id: it.id, data: { in_calendar: on ? 1 : 0 } })}
                      />
                    </Table.Td>
                    <Table.Actions>
                      <IconButton size="xs" icon={ICONS.markDone} label={t.upkeep_mark_done}
                        onClick={() => markDone.mutate({ id: it.id, doneOn: today, reading: null })} />
                      <IconButton size="xs" icon={ICONS.edit} label={t.edit} onClick={() => setItemForm({ item: it })} />
                      <IconButton size="xs" icon={Archive} label={t.upkeep_archive} onClick={() => archiveItem.mutate(it.id)} />
                    </Table.Actions>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </section>

      <section>
        <PanelTitle as={h} title={t.upkeep_readings} className="mb-3" />
        <ReadingsSection machine={machine} items={active} />
      </section>

      <FilesSection machineId={machine.id} headingAs={h} />
      <ServiceLogSection machineId={machine.id} headingAs={h} />
      <ProjectsSection machineId={machine.id} headingAs={h} />

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
