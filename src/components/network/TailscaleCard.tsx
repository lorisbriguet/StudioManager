import { openExternal } from "../../lib/openExternal";
import { Card, EmptyState, ICONS, IconButton, ListSkeleton, Tooltip } from "../ui";
import { WidgetShell, WidgetTitle } from "../dashboard/WidgetShell";
import { useT } from "../../i18n/useT";
import { useTailscale } from "../../hooks/useTailscale";
import { notify } from "../../lib/notify";
import { formatAgo } from "../../lib/network/format";
import { TAILSCALE_CONSOLE_URL, type TailscaleDevice } from "../../lib/network/commands";

function Row({ device, now }: { device: TailscaleDevice; now: number }) {
  const t = useT();
  const detail = device.online
    ? device.ip ?? t.net_machine_online
    : device.lastSeen
      ? t.net_tailscale_seen.replace("{time}", formatAgo(device.lastSeen, now, t))
      : t.net_tailscale_offline;
  const hint = [device.os, device.dnsName].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-2 h-10 text-sm border-b border-[var(--color-border-divider)]" data-testid="tailscale-device">
      <span className={`dot-sm ${device.online ? "bg-success" : "bg-checkbox-border"}`} aria-hidden />
      <span className="sr-only">{device.online ? t.net_machine_online : t.net_tailscale_offline}</span>
      <span className="truncate min-w-0">{device.name}</span>
      {device.isSelf && <span className="text-xs text-muted shrink-0">{t.net_this_mac}</span>}
      <span className="flex-1" />
      {hint ? (
        <Tooltip content={hint}>
          <span className="text-xs text-muted shrink-0 tabular-nums">{detail}</span>
        </Tooltip>
      ) : (
        <span className="text-xs text-muted shrink-0 tabular-nums">{detail}</span>
      )}
    </li>
  );
}

/**
 * Every device of the tailnet with its online state, from this Mac's Tailscale, and a button to the
 * admin console. Hidden when Tailscale isn't installed here (and in test and presentation mode).
 */
export function TailscaleCard({ now }: { now: number }) {
  const t = useT();
  const ts = useTailscale();
  if (!ts.isPending && !ts.data) return null;
  const openConsole = () =>
    void openExternal(TAILSCALE_CONSOLE_URL).catch((e) => notify.error(t.upkeep_open_failed, e));
  const s = ts.data;
  return (
    <Card as="section" padding="none">
      <WidgetShell>
        <WidgetTitle action={<IconButton icon={ICONS.openExternal} label={t.net_tailscale_console} onClick={openConsole} />}>
          {t.net_tailscale}
        </WidgetTitle>
        {ts.isPending || !s ? (
          <ListSkeleton size="sm" rows={3} />
        ) : !s.running ? (
          <EmptyState size="sm" icon={ICONS.network} message={t.net_tailscale_off} />
        ) : (
          <ul>
            {s.devices.map((d) => (
              <Row key={`${d.dnsName ?? d.name}`} device={d} now={now} />
            ))}
          </ul>
        )}
      </WidgetShell>
    </Card>
  );
}
