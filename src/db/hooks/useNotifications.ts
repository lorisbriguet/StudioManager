import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/notifications";
import type { AppNotification } from "../../types/notification";

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

export function useCreateNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<AppNotification, "id" | "created_at">) =>
      q.createNotification(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.deleteNotification,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useClearAllNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.clearAllNotifications,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
