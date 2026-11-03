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
