import { ICONS, IconButton } from "../ui";
import { useT } from "../../i18n/useT";
import { checkReason } from "../../lib/network/format";
import { linkUrl } from "../../lib/network/model";
import { openMachineAttachment } from "../../lib/upkeep/openAttachment";
import type { CheckResult } from "../../lib/network/commands";
import type { MachineFile } from "../../types/upkeep";

/** Up is success; unreachable and not-checked-yet are muted; a server error is warning. */
function dotClass(result: CheckResult | undefined): string {
  if (result?.state === "up") return "bg-success";
  if (result?.state === "error") return "bg-warning";
  return "bg-checkbox-border";
}

/** One service link: status dot, label, short reason, and an open action. The whole row opens the link. */
export function ServiceRow({ file, result }: { file: MachineFile; result?: CheckResult }) {
  const t = useT();
  const reason = checkReason(result, t);
  const open = () => void openMachineAttachment({ kind: "link", path_or_url: linkUrl(file.path_or_url) });
  return (
    <div className="group flex items-center gap-1 border-b border-[var(--color-border-divider)] rounded-md hover:bg-[var(--color-hover-row)] -mx-2 px-2">
      <button type="button" onClick={open} className="flex flex-1 min-w-0 items-center gap-2 h-10 text-left text-sm focus-accent rounded-md">
        <span className={`dot-sm ${dotClass(result)}`} aria-hidden />
        {result?.state === "up" && <span className="sr-only">{t.net_service_up}</span>}
        <span className="truncate">{file.label}</span>
        {reason && <span className="text-xs text-muted shrink-0">{reason}</span>}
      </button>
      <IconButton icon={ICONS.openExternal} label={t.net_open_service.replace("{label}", file.label)} size="xs" reveal onClick={open} />
    </div>
  );
}
