import { Link } from "react-router-dom";
import { Card, HEADING_2, SectionLabel } from "../ui";
import { useT } from "../../i18n/useT";
import { ServiceRow } from "./ServiceRow";
import type { NetworkCard } from "../../lib/network/model";
import type { CheckResult } from "../../lib/network/commands";

/** One machine: its name (a link to its Upkeep page), kind, and its services. NAS health and remote buttons join later. */
export function MachineCard({ card, results }: { card: NetworkCard; results: Map<string, CheckResult> }) {
  const t = useT();
  const { machine, services } = card;
  return (
    <Card as="section" aria-labelledby={`net-machine-${machine.id}`}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 id={`net-machine-${machine.id}`} className={`${HEADING_2} min-w-0 truncate`}>
          <Link to={`/upkeep/machines/${machine.id}`} className="hover:text-accent-text">{machine.name}</Link>
        </h2>
        <span className="text-xs text-muted truncate">{machine.kind}</span>
      </div>
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
