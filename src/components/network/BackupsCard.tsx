import { Card, EmptyState, ICONS, ListSkeleton, QueryError, Tooltip } from "../ui";
import { WidgetShell, WidgetTitle } from "../dashboard/WidgetShell";
import { useT } from "../../i18n/useT";
import { useActiveUpkeepItems } from "../../db/hooks/useUpkeep";
import { useLatestMetricsFor } from "../../db/hooks/useConnections";
import { useTimeMachine } from "../../hooks/useTimeMachine";
import { useAppStore } from "../../stores/app-store";
import { ageTone, timeMachineState, type BackupTone } from "../../lib/network/backups";
import { latestSnapshot } from "../../lib/network/nas";
import { dueState } from "../../lib/upkeep/schedule";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import type { NetworkCard } from "../../lib/network/model";

const DOT: Record<BackupTone | "none", string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  none: "bg-checkbox-border",
};

function Row({ tone, name, detail, hint }: { tone: BackupTone | "none"; name: string; detail: string; hint?: React.ReactNode }) {
  const text = <span className="text-xs text-muted shrink-0 tabular-nums">{detail}</span>;
  return (
    <li className="flex items-center gap-2 h-10 text-sm border-b border-[var(--color-border-divider)]">
      <span className={`dot-sm ${DOT[tone]}`} aria-hidden />
      <span className="truncate flex-1 min-w-0">{name}</span>
      {hint ? <Tooltip content={hint}>{text}</Tooltip> : text}
    </li>
  );
}

const unixDate = (seconds: number) => formatDisplayDate(new Date(seconds * 1000).toISOString());

/**
 * Backup sources: this Mac's Time Machine, each NAS's newest snapshot and the upkeep items marked as
 * backups. A source that was never set up is not listed; with none, the card says so.
 */
export function BackupsCard({ cards, now = Date.now() }: { cards: NetworkCard[]; now?: number }) {
  const t = useT();
  const soonDays = useAppStore((s) => s.upkeepSoonDays);
  const tm = useTimeMachine();
  const items = useActiveUpkeepItems();
  const nasCards = cards.filter((c) => c.nas);
  const readings = useLatestMetricsFor(nasCards.map((c) => c.machine.id), "snapshot_latest_at:");

  const rows: React.ReactNode[] = [];

  const state = timeMachineState(tm.data ?? null, new Date(now));
  if (state.show) {
    const s = tm.data!;
    const detail =
      state.label === "running" ? t.net_backup_running
      : state.label === "never" ? t.net_backup_none_yet
      : t.net_backup_last.replace("{date}", formatDisplayDate(s.lastBackupAt!));
    rows.push(<Row key="tm" tone={state.tone} name={t.net_time_machine} detail={detail} />);
  }

  nasCards.forEach((c, i) => {
    const snap = latestSnapshot(readings[i]?.data ?? []);
    if (!snap) return;
    rows.push(
      <Row
        key={`nas-${c.machine.id}`}
        tone={ageTone(snap.at * 1000, new Date(now))}
        name={nasCards.length > 1 ? `${t.net_nas_snapshots} · ${c.machine.name}` : t.net_nas_snapshots}
        detail={t.net_backup_last.replace("{date}", unixDate(snap.at))}
        hint={snap.byShare.map((x) => (
          <div key={x.share} data-testid="snapshot-share">{`${x.share}: ${unixDate(x.at)}`}</div>
        ))}
      />
    );
  });

  const ids = new Set(cards.map((c) => c.machine.id));
  const today = todayLocalISO();
  for (const it of items.data ?? []) {
    if (it.is_backup !== 1 || !ids.has(it.machine_id)) continue;
    const due = dueState(it, today, soonDays);
    const tone = due === "overdue" ? "danger" : due === "soon" ? "warning" : it.last_done_on ? "success" : "none";
    rows.push(
      <Row
        key={`item-${it.id}`}
        tone={tone}
        name={it.title}
        detail={it.last_done_on ? t.net_backup_last.replace("{date}", formatDisplayDate(it.last_done_on)) : t.net_backup_never_done}
      />
    );
  }

  const sources = [tm, items, ...readings];
  const pending = sources.some((x) => x.isPending);
  const failed = sources.find((x) => x.isError);
  return (
    <Card as="section" padding="none">
      <WidgetShell>
        <WidgetTitle>{t.net_backups}</WidgetTitle>
        {pending ? (
          <ListSkeleton size="sm" rows={2} />
        ) : failed ? (
          <QueryError
            message={t.load_error_network}
            onRetry={() => sources.filter((x) => x.isError).forEach((x) => void x.refetch())}
            retrying={sources.some((x) => x.isFetching)}
          />
        ) : rows.length > 0 ? (
          <ul>{rows}</ul>
        ) : (
          <EmptyState size="sm" icon={ICONS.archive} message={t.net_backups_none} />
        )}
      </WidgetShell>
    </Card>
  );
}
