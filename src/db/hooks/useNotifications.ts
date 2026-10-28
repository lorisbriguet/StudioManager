import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/notifications";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notifyError";

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: q.getNotifications,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: q.getUnreadCount,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  return useMutation({
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "notifications", where: "id = $1", params: [id] }]);
      await q.deleteNotification(id);
      pushRestore(getLabels().undo_delete_notification, snap, { redo: () => q.deleteNotification(id), invalidate });
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useClearAllNotifications() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  return useMutation({
    mutationFn: async () => {
      const snap = await snapshotRows([{ table: "notifications", where: "1 = 1" }]);
      await q.clearAllNotifications();
      pushRestore(getLabels().undo_clear_notifications, snap, { redo: q.clearAllNotifications, invalidate });
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}
