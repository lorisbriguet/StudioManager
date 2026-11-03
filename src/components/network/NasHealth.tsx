import { ListSkeleton, ProgressBar, SectionLabel } from "../ui";
import { useT } from "../../i18n/useT";
import { useLatestMetrics, useMachineDisks } from "../../db/hooks/useConnections";
import { diskHealthVariant } from "../../lib/statusColors";
import { usedOfTotal, volumeNumber, volumesFrom } from "../../lib/network/nas";

function tone(pct: number) {
  return pct >= 90 ? "danger" : pct >= 75 ? "warning" : "accent";
}

/** Volume usage and drive health of a machine's NAS, from its latest readings. Nothing until the first sync. */
export function NasHealth({ machineId }: { machineId: number }) {
  const t = useT();
  const metrics = useLatestMetrics(machineId, "volume_");
  const disks = useMachineDisks(machineId);
  if (metrics.isPending || disks.isPending) return <ListSkeleton size="sm" rows={2} className="mb-3" />;
  const volumes = volumesFrom(metrics.data ?? []);
  const list = disks.data ?? [];
  if (volumes.length === 0 && list.length === 0) return null;

  const bad = list.filter((d) => d.health !== "healthy");
  const healthLabel = { healthy: t.upkeep_disk_health_healthy, warning: t.upkeep_disk_health_warning, failing: t.upkeep_disk_health_failing };
  return (
    <section className="mb-3">
      <SectionLabel as="h3" className="mb-1">{t.net_nas}</SectionLabel>
      <ul className="flex flex-col gap-2">
        {volumes.map((v) => {
          const n = volumeNumber(v.id);
          const name = n === null ? v.id : t.net_nas_volume.replace("{n}", String(n));
          const pct = (v.used / v.total) * 100;
          return (
            <li key={v.id}>
              <div className="text-sm mb-1">{`${name} · ${usedOfTotal(v.used, v.total, t.net_nas_used_of)}`}</div>
              <ProgressBar value={pct} tone={tone(pct)} aria-label={name} />
            </li>
          );
        })}
      </ul>
      {list.length > 0 && (
        <p className="text-sm mt-2 flex flex-wrap gap-x-3">
          {bad.length === 0 ? (
            <span className="text-muted">{t.net_nas_drives_ok.replace("{n}", String(list.length))}</span>
          ) : (
            bad.map((d) => (
              <span key={d.slot} className={diskHealthVariant(d.health) === "danger" ? "text-danger-text" : "text-warning-text"}>
                {`${d.slot}: ${healthLabel[d.health] ?? d.health}`}
              </span>
            ))
          )}
        </p>
      )}
    </section>
  );
}
