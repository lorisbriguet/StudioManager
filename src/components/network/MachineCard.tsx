import { Link } from "react-router-dom";
import { Card, HEADING_2, SectionLabel } from "../ui";
import { useT } from "../../i18n/useT";
import { NasHealth } from "./NasHealth";
import { RemoteBlock } from "./RemoteBlock";
import { ServiceRow } from "./ServiceRow";
import type { NetworkCard } from "../../lib/network/model";
import type { CheckResult } from "../../lib/network/commands";
import { formatAgo } from "../../lib/network/format";

/** One machine: its name (a link to its Upkeep page), kind, and its services. NAS health and remote buttons. */
export function MachineCard({ card, results, now = Date.now() }: { card: NetworkCard; results: Map<string, CheckResult>; now?: number }) {
  const t = useT();
  const { machine, services } = card;
  return (
    <Card as="section" aria-labelledby={`net-machine-${machine.id}`}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 id={`net-machine-${machine.id}`} className={`${HEADING_2} min-w-0 truncate`}>
          <Link to={`/upkeep/machines/${machine.id}`} className="hover:text-accent-text">{machine.name}</Link>
        </h2>
        <span className="text-xs text-muted truncate">{machine.kind}</span>
        {card.nas?.last_sync_at && (
          <span className="text-xs text-muted shrink-0">
            {t.net_nas_updated.replace("{time}", formatAgo(card.nas.last_sync_at, now, t))}
          </span>
        )}
        <RemoteBlock.State card={card} result={results.get(`machine:${machine.id}`)} />
      </div>
      <RemoteBlock card={card} />
      {card.nas && <NasHealth machineId={machine.id} />}
      {services.length > 0 && (
        <section>
          <SectionLabel as="h3" className="mb-1">{t.net_services}</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {services.map((f) => (
              <ServiceRow key={f.id} file={f} result={results.get(`link:${f.id}`)} />
            ))}
          </div>
        </section>
      )}
    </Card>
  );
}
