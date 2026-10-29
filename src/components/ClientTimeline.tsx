import { Link } from "react-router-dom";
import { History, type LucideIcon } from "lucide-react";
import { EmptyState, ICONS, ICON_SIZE, ListSkeleton, QueryState } from "./ui";
import { useClientActivity } from "../db/hooks/useClients";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";
import type { ClientActivityEvent } from "../db/queries/clients";

const typeConfig: Record<string, { icon: LucideIcon; color: string; path: (id: number) => string }> = {
  invoice: { icon: ICONS.invoice, color: "text-[var(--color-info-text)]", path: (id) => `/invoices/${id}/preview` },
  quote: { icon: ICONS.quote, color: "text-[var(--color-indigo-text)]", path: (id) => `/quotes/${id}/preview` },
  project: { icon: ICONS.project, color: "text-[var(--color-success-text)]", path: (id) => `/projects/${id}` },
};

function EventRow({ event }: { event: ClientActivityEvent }) {
  const t = useT();
  const cfg = typeConfig[event.type] ?? typeConfig.project;
  const Icon = cfg.icon;

  const actionLabel = (t as Record<string, string>)[event.action] ?? event.action;

  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className={`mt-0.5 ${cfg.color}`}>
        <Icon size={ICON_SIZE.menu} />
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
  const query = useClientActivity(clientId);

  return (
    <QueryState
      query={query}
      skeleton={<ListSkeleton size="sm" rows={4} />}
      errorMessage={t.load_error_activity}
      empty={<EmptyState size="sm" icon={History} message={t.no_activity} />}
    >
      {(events) => <EventList events={events} />}
    </QueryState>
  );
}

function EventList({ events }: { events: ClientActivityEvent[] }) {
  return (
    <div className="space-y-0.5">
      {events.map((event, i) => (
        <EventRow key={`${event.type}-${event.entity_id}-${i}`} event={event} />
      ))}
    </div>
  );
}
