import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/useT";
import { Button, CARD_GAP, CARD_STACK, Card, EmptyState, ICONS, IconButton, ListSkeleton, PageHeader, QueryState } from "../components/ui";
import { MachineCard } from "../components/network/MachineCard";
import { UpkeepDueCard } from "../components/network/UpkeepDueCard";
import { useEquipmentConnections } from "../db/hooks/useConnections";
import { useMachineLinks, useMachines, useUpkeepOverview } from "../db/hooks/useUpkeep";
import { useAppStore } from "../stores/app-store";
import { useNetworkChecks } from "../hooks/useNetworkChecks";
import { formatAgo } from "../lib/network/format";
import { buildNetworkCards, linkUrl, pinFor, vncLink } from "../lib/network/model";
import type { CheckTarget } from "../lib/network/commands";

const GRID = `grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${CARD_GAP} items-start`;

export function NetworkPage() {
  const t = useT();
  const navigate = useNavigate();
  const machines = useMachines();
  const links = useMachineLinks();
  const connections = useEquipmentConnections();
  const { due } = useUpkeepOverview();
  const noChecks = useAppStore((s) => s.testMode || s.presentationMode);

  const cards = useMemo(
    () =>
      machines.data && links.data && connections.data
        ? buildNetworkCards(machines.data, links.data, connections.data)
        : undefined,
    [machines.data, links.data, connections.data]
  );
  const targets = useMemo<CheckTarget[]>(
    () =>
      (cards ?? []).flatMap((c) => {
        const vnc = vncLink(c);
        return [
          ...c.services.map((f) => ({
            key: `link:${f.id}`,
            kind: "http" as const,
            url: linkUrl(f.path_or_url),
            pin: pinFor(f.path_or_url, connections.data ?? []),
          })),
          ...(vnc ? [{ key: `machine:${c.machine.id}`, kind: "tcp" as const, url: linkUrl(vnc.path_or_url) }] : []),
        ];
      }),
    [cards, connections.data]
  );
  const { results, checkedAt, checking, refresh } = useNetworkChecks(targets);

  // Re-render every 30 s so "Checked … ago" stays true.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const queries = [machines, links, connections];
  const state = {
    data: cards,
    isPending: queries.some((x) => x.isPending),
    isError: queries.some((x) => x.isError),
    isFetching: queries.some((x) => x.isFetching),
    refetch: () => queries.forEach((x) => void x.refetch()),
  };

  const ids = new Set((cards ?? []).map((c) => c.machine.id));
  const dueRows = due.filter((r) => ids.has(r.machine.id));

  return (
    <div>
      <PageHeader
        title={t.network}
        actions={
          <>
            {checkedAt !== null && (
              <span className="text-xs text-muted">{t.net_checked_ago.replace("{time}", formatAgo(checkedAt, now, t))}</span>
            )}
            <IconButton icon={ICONS.updates} label={t.net_check_now} onClick={refresh} disabled={checking || noChecks} />
          </>
        }
      />
      <QueryState
        query={state}
        errorMessage={t.load_error_network}
        skeleton={
          <div className={GRID}>
            <Card><ListSkeleton size="sm" /></Card>
            <Card><ListSkeleton size="sm" rows={3} /></Card>
          </div>
        }
        empty={
          <EmptyState
            icon={ICONS.network}
            message={t.network_empty_title}
            hint={t.network_empty_desc}
            action={<Button variant="outline" onClick={() => navigate("/upkeep")}>{t.open_upkeep}</Button>}
          />
        }
      >
        {(list) => (
          <div className={GRID}>
            <div className={CARD_STACK}>
              {list.map((card) => (
                <MachineCard key={card.machine.id} card={card} results={results} now={now} />
              ))}
            </div>
            <div className={CARD_STACK}>
              <UpkeepDueCard rows={dueRows} />
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
