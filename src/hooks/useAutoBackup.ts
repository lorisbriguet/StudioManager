import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { createBackup, isBackupRunning, setBackupRunning, isScopeDenied } from "../lib/backup";
import { createNotification } from "../db/queries/notifications";
import { queryClient } from "../lib/queryClient";
import { logError } from "../lib/log";
import { notifyError, getLabels } from "../lib/notifyError";
import { sendNativeNotification } from "../lib/nativeNotification";

/** Distinguish fs-scope denials (stored backup dir no longer accessible)
 *  from ordinary backup failures for a clearer user message. */
function backupErrorLabel(e: unknown): string {
  return isScopeDenied(e)
    ? getLabels().backup_path_not_allowed
    : // Interpolated message: exempt from notifyError's fixed-label dedupe
      // contract — bounded by the failureNotifiedRef latch (one toast per
      // failure streak).
      getLabels().backup_failed.replace("{error}", String(e));
}

export function useAutoBackup() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latch: toast only the first failure until a backup run fully succeeds,
  // so a persistently failing interval doesn't toast every run.
  const failureNotifiedRef = useRef(false);

  useEffect(() => {
    const check = () => {
      if (isBackupRunning()) return;
      const {
        autoBackupInterval,
        backupPath,
        backupPath2,
        maxBackups,
        lastAutoBackup,
        setLastAutoBackup,
      } = useAppStore.getState();

      if (autoBackupInterval <= 0 || !backupPath) return;

      const now = Date.now();
      const elapsed = now - lastAutoBackup;
      const intervalMs = autoBackupInterval * 60 * 1000;

      if (elapsed >= intervalMs) {
        setBackupRunning(true);
        createBackup(backupPath, maxBackups)
          .then(async (path) => {
            let secondaryFailed = false;
            if (backupPath2) {
              try {
                await createBackup(backupPath2, maxBackups);
              } catch (e) {
                secondaryFailed = true;
                logError("Auto-backup (secondary) failed:", e);
                if (!failureNotifiedRef.current) {
                  failureNotifiedRef.current = true;
                  notifyError(backupErrorLabel(e), e);
                }
              }
            }
            if (!secondaryFailed) failureNotifiedRef.current = false;
            setLastAutoBackup(Date.now());
            const fileName = path.split("/").pop() ?? "backup";
            toast.success(getLabels().auto_backup_completed.replace("{file}", fileName));
            await createNotification({
              type: "info",
              title: getLabels().auto_backup_title,
              message: fileName,
              read: 0,
              link: backupPath,
            });
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            sendNativeNotification(getLabels().auto_backup_title, fileName);
          })
          .catch((e) => {
            logError("Auto-backup failed:", e);
            if (!failureNotifiedRef.current) {
              failureNotifiedRef.current = true;
              notifyError(backupErrorLabel(e), e);
            }
          })
          .finally(() => {
            setBackupRunning(false);
          });
      }
    };

    // Check immediately on mount
    check();

    // Then check every minute
    intervalRef.current = setInterval(check, 60 * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
