import { Bell, Check, CheckCheck, Trash2, AlertTriangle, Info, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
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
    if (n.link) navigate(n.link);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t.notifications}</h1>
          {unreadCount > 0 && (
            <span className="bg-accent text-white text-xs font-medium px-2 py-0.5 rounded-full">
              {unreadCount} {t.unread}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 transition-colors"
            >
              <CheckCheck size={14} />
              {t.mark_all_read}
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={() => clearAll.mutate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
              {t.clear_all}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted text-sm">{t.loading}</p>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <Bell size={40} className="mx-auto mb-3 opacity-30" />
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
                    ? "bg-transparent hover:bg-gray-50"
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
                      <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
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
                    onClick={(e) => {
                      e.stopPropagation();
                      const text = `${n.title}${n.message ? ` — ${n.message}` : ""}`;
                      navigator.clipboard.writeText(text).then(() => toast.success(t.copied));
                    }}
                    className="p-1 rounded hover:bg-gray-200"
                    title={t.copy}
                  >
                    <Copy size={14} />
                  </button>
                  {!n.read && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead.mutate(n.id);
                      }}
                      className="p-1 rounded hover:bg-gray-200"
                      title={t.mark_read}
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotif.mutate(n.id);
                    }}
                    className="p-1 rounded hover:bg-red-100 text-red-500"
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
