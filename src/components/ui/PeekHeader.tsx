import { Maximize2, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";

/**
 * PeekHeader — the top bar of a side peek panel (Projects, Calendar):
 * close on the left, open the full page on the right. The peeked page's own
 * title follows below it (PageHeader as="h2"). See DESIGN-SYSTEM.md.
 *
 *   <PeekHeader onClose={closePeek} onOpenFull={() => navigate(`/projects/${id}`)} />
 */
export function PeekHeader({ onClose, onOpenFull }: { onClose: () => void; onOpenFull: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-1 p-2 border-b border-[var(--color-border-header)]">
      <IconButton icon={X} label={t.close} onClick={onClose} />
      <IconButton icon={Maximize2} label={t.open_full_page} onClick={onOpenFull} />
    </div>
  );
}
