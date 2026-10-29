import type { LucideIcon } from "lucide-react";
import { ICONS, ICON_SIZE, PageHeader, Button, Card, CARD_LINK, CARD_CONTROL, EmptyState, IconButton, QueryState, ListSkeleton } from "../components/ui";
import { notify } from "../lib/notify";
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
import { deleteWithUndo } from "../lib/undo";
import type { AppNotification } from "../types/notification";

const typeConfig: Record<string, { icon: LucideIcon; color: string }> = {
  overdue: { icon: ICONS.reminder, color: "text-[var(--color-warning-text)]" },
  warning: { icon: ICONS.warning, color: "text-[var(--color-warning-text)]" },
  error: { icon: ICONS.error, color: "text-[var(--color-danger-text)]" },
  info: { icon: ICONS.info, color: "text-accent-text" },
};

export function NotificationsPage() {
  const t = useT();
  const notificationsQuery = useNotifications();
  const notifications = notificationsQuery.data ?? [];
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotif = useDeleteNotification();
  const clearAll = useClearAllNotifications();

  const navigate = useNavigate();

  const unreadCount = notifications.filter((n) => !n.read).length;

  function isFilePath(link: string): boolean {
    return /^\/Users\/|^\/Volumes\/|^\/tmp\/|^~\/|^\/var\//.test(link);
  }

  function handleClick(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    if (!n.link) return;
    if (isFilePath(n.link)) {
      // File system path (e.g., backup folder) — open in Finder
      invoke("open_in_finder", { path: n.link }).catch((err) => {
        notify.error(t.could_not_open_path, err);
      });
    } else if (n.link.startsWith("/")) {
      navigate(n.link);
    } else {
      // Fallback for any other external path
      invoke("open_in_finder", { path: n.link }).catch((err) => {
        notify.error(t.could_not_open_path, err);
      });
    }
  }

  return (
    <div>
      <PageHeader title={t.notifications} meta={unreadCount > 0 && `${unreadCount} ${t.unread}`}>
        {unreadCount > 0 && (
          <Button variant="secondary" icon={ICONS.markAllRead} onClick={() => markAllRead.mutate()}>
            {t.mark_all_read}
          </Button>
        )}
        {notifications.length > 0 && (
          <Button variant="danger" icon={ICONS.delete} onClick={() => deleteWithUndo(clearAll, undefined, t.notifications_cleared)}>
            {t.clear_all}
          </Button>
        )}
      </PageHeader>

      <QueryState
        query={notificationsQuery}
        skeleton={<ListSkeleton rows={6} />}
        errorMessage={t.load_error_notifications}
        empty={<EmptyState message={t.no_notifications} icon={ICONS.notifications} />}
      >
      {() => (
        <div className="space-y-2">
          {notifications.map((n) => {
            const cfg = typeConfig[n.type] ?? typeConfig.info;
            const Icon = cfg.icon;
            return (
              <Card
                key={n.id}
                // The title is the button (stretched over the card); the icon buttons sit above it.
                interactive="link"
                padding="sm"
                className={`flex items-start gap-3 group ${
                  n.read ? "" : "bg-accent-tint-strong! hover:bg-accent-light!"
                }`}
              >
                <div className={`mt-0.5 ${cfg.color}`}>
                  <Icon size={ICON_SIZE.callout} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`${CARD_LINK} text-sm ${n.read ? "text-muted" : "font-medium"}`}
                      onClick={() => handleClick(n)}
                    >
                      {n.title}
                    </button>
                    {!n.read && (
                      <span className="dot bg-accent" />
                    )}
                  </div>
                  {n.message && (
                    <p className="text-xs text-muted mt-0.5 truncate">{n.message}</p>
                  )}
                  <p className="text-[10px] text-muted mt-1">
                    {formatDisplayDateTime(n.created_at)}
                  </p>
                </div>
                <div className={`${CARD_CONTROL} flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity`}>
                  <IconButton size="xs"
                    icon={ICONS.copy}
                    label={t.copy}
                    onClick={(e) => {
                      e.stopPropagation();
                      const text = `${n.title}${n.message ? ` — ${n.message}` : ""}`;
                      navigator.clipboard.writeText(text).then(
                        () => notify.success(t.copied),
                        (err) => notify.error(t.error_copy, err)
                      );
                    }}
                  />
                  {!n.read && (
                    <IconButton size="xs"
                      icon={ICONS.markRead}
                      label={t.mark_read}
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead.mutate(n.id);
                      }}
                    />
                  )}
                  <IconButton size="xs"
                    icon={ICONS.delete}
                    label={t.delete}
                    tone="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteWithUndo(deleteNotif, n.id, t.notification_deleted);
                    }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
      </QueryState>
    </div>
  );
}
