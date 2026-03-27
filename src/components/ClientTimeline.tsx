import { Link } from "react-router-dom";
import { FileText, Receipt, FolderOpen } from "lucide-react";
import { useClientActivity } from "../db/hooks/useClients";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import type { ClientActivityEvent } from "../db/queries/clients";

const typeConfig: Record<string, { icon: typeof FileText; color: string; path: (id: number) => string }> = {
  invoice: { icon: Receipt, color: "text-blue-500", path: (id) => `/invoices/${id}/preview` },
  quote: { icon: FileText, color: "text-purple-500", path: (id) => `/quotes/${id}/preview` },
  project: { icon: FolderOpen, color: "text-green-500", path: (id) => `/projects/${id}` },
};

function EventRow({ event }: { event: ClientActivityEvent }) {
  const t = useT();
  const cfg = typeConfig[event.type] ?? typeConfig.project;
  const Icon = cfg.icon;

  const actionLabel = (t as Record<string, string>)[event.action] ?? event.action;

  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className={`mt-0.5 ${cfg.color}`}>
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <Link
          to={cfg.path(event.entity_id)}
          className="text-sm hover:text-accent transition-colors truncate block"
        >
          {event.label}
        </Link>
        <span className="text-xs text-muted">
          {actionLabel} — {formatDisplayDate(event.date)}
        </span>
      </div>
    </div>
  );
}

interface Props {
  clientId: string;
}

export function ClientTimeline({ clientId }: Props) {
  const t = useT();
  const { data: events, isLoading } = useClientActivity(clientId);

  if (isLoading) return <div className="text-sm text-muted py-2">{t.loading}</div>;

  if (!events || events.length === 0) {
    return <div className="text-sm text-muted py-2">{t.no_activity}</div>;
  }

  return (
    <div className="space-y-0.5">
      {events.map((event, i) => (
        <EventRow key={`${event.type}-${event.entity_id}-${i}`} event={event} />
      ))}
    </div>
  );
}
