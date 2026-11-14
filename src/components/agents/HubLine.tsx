import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useT } from "../../i18n/useT";
import { useNow } from "../../hooks/useNow";
import { qk } from "../../db/queryKeys";
import { formatAgo } from "../../lib/network/format";
import { getStoredTagColor } from "../../lib/tagColors";
import { HUB_MAX_FAILS, hubErrorText, isHubTooSoon, openInHub, refreshHub, type HubView } from "../../lib/hubs";
import { Badge, Button, ICONS } from "../ui";

type T = ReturnType<typeof useT>;

/** The hub's colour as a small dot. */
export function HubDot({ colour }: { colour: string }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: getStoredTagColor(colour).text }} />;
}

/**
 * The state of a hub as one plain line: what waits, or why it is not reached. `problem` comes
 * from a connector: it is only ever placed in a text node.
 */
export function hubStateLine(h: HubView, t: T, now: number): string {
  if (!h.approved) return t.hubs_needs_allowing;
  if (h.paused) return t.hubs_paused.replace("{n}", String(HUB_MAX_FAILS));
  if (h.problem) {
    // A failed or unstarted connector keeps Rust's text: it carries the reason (the first error line).
    const worded = h.problemKind && h.problemKind !== "failed" && h.problemKind !== "notStarted";
    const text = worded && h.problemKind ? t[`hubs_problem_${h.problemKind}`] : h.problem;
    const base = t.hubs_not_reached.replace("{problem}", text);
    // Texts from Rust end with a full stop, the app's own wording does not: one separator either way.
    return h.nextTryAt ? `${/[.!?…]$/.test(base) ? base : `${base}.`} ${t.hubs_next_try.replace("{time}", format(new Date(h.nextTryAt), "HH:mm"))}` : base;
  }
  if (h.waiting !== null && h.checkedAt !== null) {
    return t.hubs_state_ok.replace("{n}", String(h.waiting)).replace("{time}", formatAgo(h.checkedAt, now, t));
  }
  return t.hubs_state_unchecked;
}

/** Whether the line is a reason (a muted state with Try again) rather than a count. */
export const hubIsUnreached = (h: HubView) => !h.approved || h.paused || !!h.problem || !h.fresh;

/** Refreshes one hub, then lets the lists read again. Resolves to an error text or null. */
export function useHubRefresh() {
  const qc = useQueryClient();
  const t = useT();
  return async (id: string): Promise<string | null> => {
    try {
      await refreshHub(id);
      return null;
    } catch (e) {
      return isHubTooSoon(e) ? t.hubs_too_soon : hubErrorText(e);
    } finally {
      void qc.invalidateQueries({ queryKey: qk.hubs.all });
    }
  };
}

/** One connected hub in Needs you: its count (or why it is not reached) and a way into the hub. */
export function HubLine({ hub: h }: { hub: HubView }) {
  const t = useT();
  const now = useNow();
  const refresh = useHubRefresh();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const unreached = hubIsUnreached(h);
  const waiting = h.waiting ?? 0;

  return (
    <li className="px-2 py-3 border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <HubDot colour={h.colour} />
        <span className="text-sm font-medium">{h.name}</span>
        {unreached ? (
          <>
            <span className="text-xs text-muted">{hubStateLine(h, t, now)}</span>
            <Button variant="secondary" loading={h.busy} onClick={() => void refresh(h.id).then(setError)}>
              {t.hubs_try_again}
            </Button>
          </>
        ) : (
          waiting > 0 && <Badge variant="accent">{t.hubs_waiting.replace("{n}", String(waiting))}</Badge>
        )}
        <span className="ml-auto">
          <Button
            variant="link"
            icon={ICONS.openExternal}
            loading={opening}
            onClick={() => {
              setOpening(true);
              void openInHub(h.id)
                .then(
                  () => setError(null),
                  (e) => setError(hubErrorText(e)),
                )
                .finally(() => setOpening(false));
            }}
          >
            {t.hubs_open}
          </Button>
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-text">
          {error}
        </p>
      )}
    </li>
  );
}
