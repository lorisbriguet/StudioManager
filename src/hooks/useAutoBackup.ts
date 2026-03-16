import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { createBackup } from "../lib/backup";
import { createNotification } from "../db/queries/notifications";

export function useAutoBackup() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const check = () => {
      if (runningRef.current) return;
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
        runningRef.current = true;
        createBackup(backupPath, maxBackups)
          .then(async (path) => {
            if (backupPath2) {
              try {
                await createBackup(backupPath2, maxBackups);
              } catch (e) {
                console.error("Auto-backup (secondary) failed:", e);
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
              link: null,
            });
            // Lazy import to avoid circular dependency with App.tsx
            const { queryClient } = await import("../App");
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          })
          .catch((e) => {
            console.error("Auto-backup failed:", e);
          })
          .finally(() => {
            runningRef.current = false;
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
