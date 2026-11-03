import { ListSkeleton, ProgressBar, QueryError, SectionLabel } from "../ui";
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
  if (metrics.isError || disks.isError) {
    return (
      <QueryError
        className="mb-3"
        message={t.load_error_network}
        onRetry={() => { if (metrics.isError) void metrics.refetch(); if (disks.isError) void disks.refetch(); }}
        retrying={metrics.isFetching || disks.isFetching}
      />
    );
  }
  const volumes = volumesFrom(metrics.data ?? []);
  const list = disks.data ?? [];
  if (volumes.length === 0 && list.length === 0) return null;

  const bad = list.filter((d) => d.health !== "healthy");
  const healthLabel = { healthy: t.upkeep_disk_health_healthy, warning: t.upkeep_disk_health_warning, failing: t.upkeep_disk_health_failing };
  return (
    <section className="mb-3">
      <SectionLabel as="h3" className="mb-1">{t.net_nas}</SectionLabel>
      <ul>
        {volumes.map((v) => {
          const n = volumeNumber(v.id);
          const name = n === null ? v.id : t.net_nas_volume.replace("{n}", String(n));
          const pct = (v.used / v.total) * 100;
          return (
            <li key={v.id} className="flex items-center gap-3 h-10 border-b border-[var(--color-border-divider)]">
              <span className="text-sm shrink-0">{`${name} · ${usedOfTotal(v.used, v.total, t.net_nas_used_of)}`}</span>
              <ProgressBar className="flex-1 min-w-0" value={pct} tone={tone(pct)} aria-label={name} />
            </li>
          );
        })}
      </ul>
      {list.length > 0 && (
        <p className="text-sm flex flex-wrap items-center gap-x-3 min-h-10 border-b border-[var(--color-border-divider)]">
          {bad.length === 0 ? (
            <span className="text-muted">{list.length === 1 ? t.net_nas_drives_ok_one : t.net_nas_drives_ok.replace("{n}", String(list.length))}</span>
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
