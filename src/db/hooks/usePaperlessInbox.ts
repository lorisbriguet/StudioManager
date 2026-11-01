import { invoke } from "@tauri-apps/api/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getConnections } from "../queries/connections";
import { getPaperlessLinks } from "../queries/paperlessLinks";
import { connectionConfig } from "../../lib/upkeep/connections";
import { OFFLINE_PREFIX, type InboxDoc, type InboxItem } from "../../lib/paperless/inbox";
import { useOrgStore } from "../../stores/org-store";

/** Query key of the inbox; invalidate it after linking or dismissing a document. */
export const paperlessInboxKey = (connectionId: number | null) => ["paperless-inbox", connectionId] as const;

export interface PaperlessInbox {
  items: InboxItem[];
  offline: boolean;
  error: string | null;
  refresh(): void;
  connection: { id: number; host: string; port: number } | null;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function usePaperlessInbox(): PaperlessInbox {
  const org = useOrgStore((s) => s.activeId);
  const conns = useQuery({ queryKey: ["connections"], queryFn: getConnections });
  const c = (conns.data ?? []).filter((x) => x.kind === "paperless").sort((a, b) => a.id - b.id)[0] ?? null;
  const connection = c ? { id: c.id, host: c.host ?? "", port: c.port ?? 0 } : null;

  // Queries never toast (only the mutation cache does): a failed fetch shows as the offline chip or an error line.
  const q = useQuery({
    queryKey: paperlessInboxKey(c?.id ?? null),
    enabled: !!c,
    queryFn: async (): Promise<InboxItem[]> => {
      const docs = await invoke<InboxDoc[]>("paperless_inbox", { org, id: c!.id, config: connectionConfig(c!) });
      const links = await getPaperlessLinks(c!.id);
      return docs
        .filter((d) => links.get(d.id)?.state !== "linked")
        .map((d) => ({
          connectionId: c!.id,
          docId: d.id,
          title: d.title,
          supplier: d.correspondent,
          date: d.created,
          state: links.get(d.id)?.state === "dismissed" ? ("dismissed" as const) : ("new" as const),
        }));
    },
    retry: false,
    refetchInterval: 30 * 60_000,
    refetchOnMount: "always",
    placeholderData: keepPreviousData,
  });

  const message = q.error ? errorMessage(q.error) : null;
  const offline = !!message && message.startsWith(OFFLINE_PREFIX);
  return {
    // Offline keeps the last successful items (react-query keeps `data` through a failed refetch); other errors empty it.
    items: !c || (message && !offline) ? [] : q.data ?? [],
    offline,
    error: offline ? null : message,
    refresh: () => void q.refetch(),
    connection,
  };
}
