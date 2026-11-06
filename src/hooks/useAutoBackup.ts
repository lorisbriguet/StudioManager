import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/app-store";
import { createBackup, isBackupRunning, setBackupRunning, isScopeDenied } from "../lib/backup";
import { createNotification } from "../db/queries/notifications";
import { queryClient } from "../lib/queryClient";
import { logError } from "../lib/log";
import { getLabels, notify } from "../lib/notify";
import { sendNativeNotification } from "../lib/nativeNotification";
import { modeActive } from "../lib/activeMode";

/** Distinguish fs-scope denials (stored backup dir no longer accessible)
 *  from ordinary backup failures for a clearer user message. */
function backupErrorLabel(e: unknown): string {
  return isScopeDenied(e) ? getLabels().backup_path_not_allowed : getLabels().auto_backup_failed;
}

const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

export function useAutoBackup() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latch: toast only the first failure until a backup run fully succeeds,
  // so a persistently failing interval doesn't toast every run.
  const failureNotifiedRef = useRef(false);
  // A failed run is not recorded as the last backup, so without a pause the
  // one-minute check would retry (and snapshot every organisation) each minute.
  const retryAfterRef = useRef(0);

  useEffect(() => {
    const check = () => {
      // A backup of test or presentation data would rotate the real backups
      // away (same folder, same name prefix).
      if (isBackupRunning() || modeActive()) return;
      const {
        autoBackupInterval,
        backupPath,
        backupPath2,
        lastAutoBackup,
        setLastAutoBackup,
      } = useAppStore.getState();

      if (autoBackupInterval <= 0 || !backupPath) return;

      const now = Date.now();
      const elapsed = now - lastAutoBackup;
      const intervalMs = autoBackupInterval * 60 * 1000;

      if (elapsed >= intervalMs && now >= retryAfterRef.current) {
        setBackupRunning(true);
        // Every organisation; each into its own backup folder when it has one.
        createBackup(backupPath, { ownFolders: true })
          .then(async (path) => {
            retryAfterRef.current = 0;
            let secondaryFailed = false;
            if (backupPath2) {
              try {
                // The second copy keeps every organisation in one folder.
                await createBackup(backupPath2);
              } catch (e) {
                secondaryFailed = true;
                logError("Auto-backup (secondary) failed:", e);
                if (!failureNotifiedRef.current) {
                  failureNotifiedRef.current = true;
                  notify.error(backupErrorLabel(e), e);
                }
              }
            }
            if (!secondaryFailed) failureNotifiedRef.current = false;
            setLastAutoBackup(Date.now());
            const fileName = path.split("/").pop() ?? "backup";
            // No toast for a routine background backup: the notification
            // centre and the native notification record it.
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
            retryAfterRef.current = Date.now() + RETRY_AFTER_FAILURE_MS;
            if (!failureNotifiedRef.current) {
              failureNotifiedRef.current = true;
              notify.error(backupErrorLabel(e), e);
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
