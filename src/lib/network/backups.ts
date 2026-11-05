import type { TimeMachineStatus } from "./commands";

export type BackupTone = "success" | "warning" | "danger";

const DAY = 86_400_000;

/** How stale a backup is: success up to 2 days, warning up to 7, danger beyond. Shared by Time Machine and the NAS. */
export function ageTone(at: string | number, now: Date): BackupTone {
  const days = (now.getTime() - (typeof at === "number" ? at : new Date(at).getTime())) / DAY;
  return days > 7 ? "danger" : days > 2 ? "warning" : "success";
}

/** What the Backups card shows for Time Machine: hidden, or a tone and which wording to use. */
export function timeMachineState(
  s: TimeMachineStatus | null,
  now: Date
): { show: boolean; tone: BackupTone; label: "running" | "last" | "never" } {
  if (!s || !s.enabled) return { show: false, tone: "success", label: "never" };
  if (!s.lastBackupAt) return { show: true, tone: "warning", label: s.running ? "running" : "never" };
  const byAge = ageTone(s.lastBackupAt, now);
  if (s.running) return { show: true, tone: byAge, label: "running" };
  const failed = s.lastResult !== null && s.lastResult !== 0;
  return { show: true, tone: failed ? "danger" : byAge, label: "last" };
}

/** One Time Machine row of the Backups card. `name` null: the only Time Machine, shown as "Time Machine". */
export interface TimeMachineRow {
  key: string;
  name: string | null;
  isThisMac: boolean;
  tone: BackupTone;
  label: "running" | "last" | "never";
  /** Last completed backup, ISO 8601, when label is "last". */
  lastBackupAt: string | null;
}

/** Curly and straight apostrophes, case and spaces don't matter: "Loris’s Mac" is "loris's mac". */
const sameComputer = (a: string, b: string) => {
  const norm = (s: string) => s.trim().replace(/[\u2018\u2019]/g, "'").toLowerCase();
  return norm(a) === norm(b);
};

/**
 * This Mac's Time Machine and the backups kept on the NAS, one row per computer. The bundle named
 * after this Mac merges with its local reading (which knows a running or failed backup), keeping
 * the newer date. Without NAS backups, the local row keeps its plain "Time Machine" name.
 */
export function timeMachineRows(
  local: TimeMachineStatus | null,
  nas: { computer: string; at: number }[],
  now: Date
): TimeMachineRow[] {
  // A computer backed up to two NASes shows once, with its newest backup.
  const newest = new Map<string, { computer: string; at: number }>();
  for (const b of nas) {
    const key = [...newest.keys()].find((k) => sameComputer(k, b.computer)) ?? b.computer;
    const prev = newest.get(key);
    if (!prev || b.at > prev.at) newest.set(key, { computer: prev?.computer ?? b.computer, at: b.at });
  }
  const remote = [...newest.values()];
  const rows: TimeMachineRow[] = [];

  const localState = timeMachineState(local, now);
  if (local && localState.show) {
    const name = local.computerName;
    const match = name ? remote.find((b) => sameComputer(b.computer, name)) : undefined;
    let merged = local;
    if (match) {
      const fromNas = new Date(match.at * 1000).toISOString();
      if (!local.lastBackupAt || fromNas > new Date(local.lastBackupAt).toISOString()) {
        merged = { ...local, lastBackupAt: fromNas, lastResult: local.running ? local.lastResult : 0 };
      }
      remote.splice(remote.indexOf(match), 1);
    }
    const st = timeMachineState(merged, now);
    rows.push({
      key: "tm",
      name: match || remote.length > 0 ? (name ?? null) : null,
      isThisMac: true,
      tone: st.tone,
      label: st.label,
      lastBackupAt: merged.lastBackupAt,
    });
  }

  remote
    .sort((a, b) => a.computer.localeCompare(b.computer))
    .forEach((b) => {
      const at = new Date(b.at * 1000).toISOString();
      rows.push({ key: `tm-nas:${b.computer}`, name: b.computer, isThisMac: false, tone: ageTone(at, now), label: "last", lastBackupAt: at });
    });
  return rows;
}
