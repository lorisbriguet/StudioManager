import { Bell, Check, CheckCheck, Trash2, AlertTriangle, Info, AlertCircle, Copy } from "lucide-react";
import { PageHeader, Button } from "../components/ui";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  useNotifications,

  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useClearAllNotifications,
} from "../db/hooks/useNotifications";
import { formatDisplayDateTime } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import type { AppNotification } from "../types/notification";

const typeConfig: Record<string, { icon: typeof Bell; color: string }> = {
  overdue: { icon: AlertTriangle, color: "text-orange-500" },
  warning: { icon: AlertTriangle, color: "text-yellow-500" },
  error: { icon: AlertCircle, color: "text-red-500" },
  info: { icon: Info, color: "text-accent" },
};

export function NotificationsPage() {
  const t = useT();
  const { data: notifications = [], isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotif = useDeleteNotification();
  const clearAll = useClearAllNotifications();

  const navigate = useNavigate();

  const unreadCount = notifications.filter((n) => !n.read).length;

  function handleClick(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    if (n.link) {
      if (n.link.startsWith("/")) {
        navigate(n.link);
      } else {
        // External path (e.g., backup folder) — open in Finder
        invoke("open_in_finder", { path: n.link }).catch(() => {});
      }
    }
  }

  return (
    <div>
      <PageHeader title={`${t.notifications}${unreadCount > 0 ? ` (${unreadCount} ${t.unread})` : ""}`}>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" icon={<CheckCheck size={14} />} onClick={() => markAllRead.mutate()}>
            {t.mark_all_read}
          </Button>
        )}
        {notifications.length > 0 && (
          <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => clearAll.mutate()}>
            {t.clear_all}
          </Button>
        )}
      </PageHeader>

      {isLoading ? (
        <p className="text-muted text-sm">{t.loading}</p>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <Bell size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t.no_notifications}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => {
            const cfg = typeConfig[n.type] ?? typeConfig.info;
            const Icon = cfg.icon;
            return (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex items-start gap-3 px-4 py-3 rounded-lg transition-colors cursor-pointer group ${
                  n.read
                    ? "bg-transparent hover:bg-[var(--color-hover-row)]"
                    : "bg-accent-light/50 hover:bg-accent-light"
                }`}
              >
                <div className={`mt-0.5 ${cfg.color}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${n.read ? "text-muted" : "font-medium"}`}>
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="dot bg-accent" />
                    )}
                  </div>
                  {n.message && (
                    <p className="text-xs text-muted mt-0.5 truncate">{n.message}</p>
                  )}
                  <p className="text-[10px] text-muted/60 mt-1">
                    {formatDisplayDateTime(n.created_at)}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1 text-muted hover:text-[var(--color-text-secondary)] transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      const text = `${n.title}${n.message ? ` — ${n.message}` : ""}`;
                      navigator.clipboard.writeText(text).then(() => toast.success(t.copied));
                    }}
                    title={t.copy}
                  >
                    <Copy size={14} />
                  </button>
                  {!n.read && (
                    <button
                      className="p-1 text-muted hover:text-[var(--color-text-secondary)] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead.mutate(n.id);
                      }}
                      title={t.mark_read}
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    className="p-1 text-muted hover:text-red-500 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotif.mutate(n.id);
                    }}
                    title={t.delete}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
