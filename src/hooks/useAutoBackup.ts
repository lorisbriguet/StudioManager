import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { createBackup, isBackupRunning, setBackupRunning } from "../lib/backup";
import { createNotification } from "../db/queries/notifications";
import { queryClient } from "../lib/queryClient";
import { logError } from "../lib/log";
import { sendNativeNotification } from "../lib/nativeNotification";

export function useAutoBackup() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
            if (backupPath2) {
              try {
                await createBackup(backupPath2, maxBackups);
              } catch (e) {
                logError("Auto-backup (secondary) failed:", e);
              }
            }
            setLastAutoBackup(Date.now());
            const fileName = path.split("/").pop() ?? "backup";
            toast.success(`Auto-backup: ${fileName}`);
            await createNotification({
              type: "info",
              title: "Auto-backup",
              message: fileName,
              read: 0,
              link: backupPath,
            });
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            sendNativeNotification("Auto-backup", fileName);
          })
          .catch((e) => {
            logError("Auto-backup failed:", e);
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
