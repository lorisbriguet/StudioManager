import { formatBytesShort } from "./format";

type Row = { metric: string; value: number };

const TOTAL = "volume_total_bytes:";
const USED = "volume_used_bytes:";
const SNAPSHOT = "snapshot_latest_at:";

/** Used and total bytes per volume (a volume missing one of them is left out), by id. */
export function volumesFrom(rows: Row[]): { id: string; used: number; total: number }[] {
  const total = new Map<string, number>();
  const used = new Map<string, number>();
  for (const r of rows) {
    if (r.metric.startsWith(TOTAL)) total.set(r.metric.slice(TOTAL.length), r.value);
    else if (r.metric.startsWith(USED)) used.set(r.metric.slice(USED.length), r.value);
  }
  return [...total]
    .filter(([id, t]) => t > 0 && used.has(id))
    .map(([id, t]) => ({ id, used: used.get(id)!, total: t }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The newest snapshot (Unix seconds) over all shared folders, and each folder's own; null without any. */
export function latestSnapshot(rows: Row[]): { at: number; byShare: { share: string; at: number }[] } | null {
  const byShare = rows
    .filter((r) => r.metric.startsWith(SNAPSHOT))
    .map((r) => ({ share: r.metric.slice(SNAPSHOT.length), at: r.value }))
    .sort((a, b) => a.share.localeCompare(b.share));
  if (byShare.length === 0) return null;
  return { at: Math.max(...byShare.map((s) => s.at)), byShare };
}

/** "volume_1" → 1; null for any other id. */
export function volumeNumber(id: string): number | null {
  const m = /^volume_(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** "4.8 of 7 TB": the unit is said once when both sizes share it. */
export function usedOfTotal(used: number, total: number, template: string): string {
  const u = formatBytesShort(used);
  const t = formatBytesShort(total);
  const unit = (s: string) => s.slice(s.indexOf(" ") + 1);
  const usedText = unit(u) === unit(t) ? u.slice(0, u.indexOf(" ")) : u;
  return template.replace("{used}", usedText).replace("{total}", t);
}
