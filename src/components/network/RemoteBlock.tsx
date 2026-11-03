import { Button, ICONS } from "../ui";
import { useT } from "../../i18n/useT";
import { notify } from "../../lib/notify";
import { openRemoteLink, type CheckResult } from "../../lib/network/commands";
import { vncLink, type NetworkCard } from "../../lib/network/model";

/** Online / Unreachable next to the machine name; nothing for a machine without a Screen Sharing link or before its first check. */
function RemoteState({ card, result }: { card: NetworkCard; result?: CheckResult }) {
  const t = useT();
  if (!vncLink(card) || !result) return null;
  const up = result.state === "up";
  return (
    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted shrink-0">
      <span className={`dot-sm ${up ? "bg-success" : "bg-checkbox-border"}`} aria-hidden />
      {up ? t.net_machine_online : t.net_unreachable}
    </span>
  );
}

/** One button per remote link (Screen Sharing, Jump Desktop). The link is opened by id in Rust, never by URL from here. */
export function RemoteBlock({ card }: { card: NetworkCard }) {
  const t = useT();
  if (card.remote.length === 0) return null;
  const open = (id: number) =>
    openRemoteLink(id).catch((e) => notify.error(t.upkeep_open_failed, e));
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {card.remote.map((f) => (
        <Button
          key={f.id}
          variant="outline"
          icon={ICONS.openExternal}
          onClick={() => void open(f.id)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );
}

RemoteBlock.State = RemoteState;
