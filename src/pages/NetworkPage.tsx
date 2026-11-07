import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/useT";
import { Button, CARD_GAP, CARD_STACK, Card, EmptyState, ICONS, IconButton, ListSkeleton, PageHeader, QueryState } from "../components/ui";
import { MachineCard } from "../components/network/MachineCard";
import { BackupsCard } from "../components/network/BackupsCard";
import { UpkeepDueCard } from "../components/network/UpkeepDueCard";
import { TailscaleCard } from "../components/network/TailscaleCard";
import { useEquipmentConnections } from "../db/hooks/useConnections";
import { useMachineLinks, useMachines, useUpkeepOverview } from "../db/hooks/useUpkeep";
import { useAppStore } from "../stores/app-store";
import { useTimeMachine } from "../hooks/useTimeMachine";
import { useTailscale } from "../hooks/useTailscale";
import { useNetworkChecks } from "../hooks/useNetworkChecks";
import { useNow } from "../hooks/useNow";
import { timeMachineState } from "../lib/network/backups";
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
  // Every overdue and soon-due item, as on the Upkeep page and its sidebar badge.
  const { due } = useUpkeepOverview();
  const tm = useTimeMachine();
  const tailscale = useTailscale();
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
  const now = useNow(30_000);

  const queries = [machines, links, connections];
  const state = {
    data: cards,
    isPending: queries.some((x) => x.isPending),
    isError: queries.some((x) => x.isError),
    isFetching: queries.some((x) => x.isFetching),
    refetch: () => queries.forEach((x) => void x.refetch()),
  };

  // Empty only when there is nothing to list, Time Machine is off and Tailscale isn't installed:
  // backups of this Mac and the tailnet still deserve the page.
  const hasBackups = tm.isPending || timeMachineState(tm.data ?? null, new Date(now)).show;
  const hasTailnet = tailscale.isPending || !!tailscale.data;
  const checkAll = () => {
    void refresh();
    void tailscale.refetch();
  };

  return (
    <div>
      <PageHeader
        title={t.network}
        actions={
          <>
            {checkedAt !== null && (
              <span className="text-xs text-muted">{t.net_checked_ago.replace("{time}", formatAgo(checkedAt, now, t))}</span>
            )}
            <IconButton icon={ICONS.updates} label={t.net_check_now} onClick={checkAll} disabled={checking || noChecks} />
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
        isEmpty={(list) => list.length === 0 && !hasBackups && !hasTailnet}
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
              <TailscaleCard now={now} />
              <BackupsCard cards={list} now={now} />
              <UpkeepDueCard rows={due} />
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
