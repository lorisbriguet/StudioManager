import { useState } from "react";
import { Badge, Button, FIELD_LABEL, FormField, Input, ProgressBar, Select, Table } from "../ui";
import { notify } from "../../lib/notify";
import { useT } from "../../i18n/useT";
import {
  useConnections,
  useCurrentReading,
  useLinkMachine,
  useMachineDisks,
  useRecordManualReading,
  useSyncNow,
} from "../../db/hooks/useConnections";
import { connectionErrorText, connectionStatusText, testConnection } from "../../lib/upkeep/connections";
import { connectionVariant, diskHealthVariant } from "../../lib/statusColors";
import type { DeviceInfo } from "../../db/queries/connections";
import type { Machine, MachineDisk, UpkeepItem } from "../../types/upkeep";

/** Drive age bar runs full at this many years. */
const DRIVE_LIFE_YEARS = 5;
const HOURS_PER_YEAR = 24 * 365;

/** Age from power-on hours, else from the first time the app saw the serial (spec §8). */
function diskAgeYears(d: MachineDisk, now = Date.now()): number {
  if (d.power_on_hours != null) return d.power_on_hours / HOURS_PER_YEAR;
  const seen = Date.parse(d.first_seen.replace(" ", "T"));
  return Number.isFinite(seen) ? Math.max(0, (now - seen) / 3_600_000 / HOURS_PER_YEAR) : 0;
}

function ageTone(years: number): "danger" | "warning" | "success" {
  if (years >= DRIVE_LIFE_YEARS) return "danger";
  if (years >= DRIVE_LIFE_YEARS * 0.6) return "warning";
  return "success";
}

/** Name and unit of a usage metric; unknown metrics show their key. */
function metricLabel(metric: string, t: ReturnType<typeof useT>): { name: string; unit: string } {
  if (metric === "print_hours") return { name: t.upkeep_print_hours, unit: t.upkeep_hours_short };
  return { name: metric, unit: "" };
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

function Disks({ machineId }: { machineId: number }) {
  const t = useT();
  const { data: disks = [] } = useMachineDisks(machineId);
  if (disks.length === 0) return null;
  return (
    <div>
      <div className={`${FIELD_LABEL} mb-1`}>{t.upkeep_disks}</div>
      <Table density="compact">
        <Table.Body>
          {disks.map((d) => {
            const years = diskAgeYears(d);
            const age = t.upkeep_disk_age_years.replace("{n}", fmt(years));
            return (
              <Table.Row key={d.id}>
                <Table.Td className="font-medium whitespace-nowrap">{d.slot}</Table.Td>
                <Table.Td muted>{d.model ?? ""}</Table.Td>
                <Table.Td>
                  <Badge variant={diskHealthVariant(d.health)}>{t[`upkeep_disk_health_${d.health}` as const]}</Badge>
                </Table.Td>
                <Table.Td>
                  <div className="flex items-center gap-2.5">
                    <ProgressBar className="w-[120px]" value={(years / DRIVE_LIFE_YEARS) * 100} tone={ageTone(years)} aria-label={age} />
                    <span className="text-xs text-muted tabular-nums whitespace-nowrap">{age}</span>
                  </div>
                </Table.Td>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </div>
  );
}

/** Typed-in reading for a machine without a connection; re-forecasts its usage items. */
function ManualReading({ machine }: { machine: Machine }) {
  const t = useT();
  const record = useRecordManualReading();
  const [draft, setDraft] = useState("");
  const value = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(value) && value >= 0;
  const save = () => {
    if (!valid) return;
    record.mutate({ machine, value }, { onSuccess: () => setDraft("") });
  };
  return (
    <div className="flex items-end gap-2">
      <FormField label={t.upkeep_current_reading}>
        <Input
          type="number"
          min={0}
          width="md"
          numeric
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
      </FormField>
      <Button variant="secondary" disabled={!valid} loading={record.isPending} onClick={save}>
        {t.upkeep_current_reading_save}
      </Button>
    </div>
  );
}

function LinkForm({ machine, needsBaseline }: { machine: Machine; needsBaseline: boolean }) {
  const t = useT();
  const { data: connections = [] } = useConnections();
  const link = useLinkMachine();
  const [connId, setConnId] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [baseline, setBaseline] = useState("");
  const [finding, setFinding] = useState(false);
  if (connections.length === 0) return null;
  const conn = connections.find((c) => c.id === connId) ?? null;
  // Bambu counts hours only from the connection on: the printer's own counter
  // today is the starting value (spec §8).
  const askBaseline = needsBaseline || conn?.kind === "bambu_cloud";

  const find = async () => {
    if (!conn) return;
    setFinding(true);
    try {
      const list = await testConnection(conn);
      setDevices(list);
      setDeviceId(list[0]?.device_id ?? "");
    } catch (e) {
      notify.error(connectionErrorText(e, t), e);
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className={FIELD_LABEL}>{t.upkeep_link_connection}</div>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          fullWidth={false}
          aria-label={t.upkeep_link_connection}
          value={connId ?? ""}
          onChange={(e) => { setConnId(e.target.value ? Number(e.target.value) : null); setDevices(null); }}
        >
          <option value="">{t.upkeep_link_connection}</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Button variant="secondary" disabled={!conn} loading={finding} onClick={() => void find()}>
          {t.upkeep_find_devices}
        </Button>
      </div>
      {devices && devices.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={t.upkeep_device}>
            <Select fullWidth={false} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {[d.name, d.model, d.device_id].filter(Boolean).join(" · ")}
                </option>
              ))}
            </Select>
          </FormField>
          {askBaseline && (
            <FormField label={t.upkeep_reading_baseline}>
              <Input type="number" min={0} width="md" numeric value={baseline}
                onChange={(e) => setBaseline(e.target.value)} />
            </FormField>
          )}
          <Button
            disabled={!deviceId}
            loading={link.isPending}
            onClick={() => link.mutate({
              id: machine.id,
              connection_id: conn?.id ?? null,
              device_id: deviceId,
              reading_baseline: baseline.trim() !== "" && Number.isFinite(Number(baseline)) ? Number(baseline) : null,
              // Prints count from now: the baseline covers what came before.
              linked_at: new Date().toISOString(),
            })}
          >
            {t.upkeep_link}
          </Button>
        </div>
      )}
      {devices && devices.length > 0 && askBaseline && (
        <p className="text-xs text-muted">{t.upkeep_reading_baseline_desc}</p>
      )}
    </div>
  );
}

/**
 * Machine detail › Readings: the linked connection (last sync, error, Sync
 * now), print hours, drives with health and age; for a machine without a
 * connection, the current reading typed in and linking to a connection.
 */
export function ReadingsSection({ machine, items }: { machine: Machine; items: UpkeepItem[] }) {
  const t = useT();
  const { data: connections = [] } = useConnections();
  const usage = items.find((i) => i.schedule === "usage" && !i.archived);
  const metric = usage?.usage_metric ?? "print_hours";
  const label = metricLabel(metric, t);
  const { data: reading = null } = useCurrentReading(machine.id, metric);
  const syncNow = useSyncNow();
  const link = useLinkMachine();
  const conn = connections.find((c) => c.id === machine.connection_id) ?? null;

  return (
    <div className="space-y-4">
      {conn ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm">{t.upkeep_connected_to.replace("{label}", conn.label)}</div>
            <div className={`text-xs ${conn.last_error ? "text-[var(--color-danger-text)]" : "text-muted"}`}>
              {connectionStatusText(conn, t)}
            </div>
          </div>
          {conn.last_sync_at && (
            <Badge variant={connectionVariant(conn.failing_since != null)}>
              {conn.failing_since ? t.upkeep_connection_failing : t.upkeep_connection_ok}
            </Badge>
          )}
          <Button variant="secondary" loading={syncNow.isPending} onClick={() => syncNow.mutate(conn.id)}>
            {t.upkeep_sync_now}
          </Button>
          <Button variant="outline"
            onClick={() => link.mutate({ id: machine.id, connection_id: null, device_id: null, reading_baseline: machine.reading_baseline, linked_at: null })}>
            {t.upkeep_unlink}
          </Button>
        </div>
      ) : (
        !usage && connections.length === 0 && <p className="text-sm text-muted">{t.upkeep_no_connection}</p>
      )}

      {(usage || reading != null) && (
        <div className="text-sm">
          <span className="text-muted">{label.name}: </span>
          <span className="tabular-nums">
            {reading != null ? `${fmt(reading)}${label.unit ? ` ${label.unit}` : ""}` : "—"}
          </span>
        </div>
      )}

      <Disks machineId={machine.id} />

      {!conn && usage && <ManualReading machine={machine} />}
      {!conn && <LinkForm machine={machine} needsBaseline={!!usage || machine.template_key === "printer_3d"} />}
    </div>
  );
}
