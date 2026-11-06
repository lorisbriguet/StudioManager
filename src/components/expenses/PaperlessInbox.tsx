import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { ICONS, Button, IconButton, FilterChip, Callout, EmptyState } from "../ui";
import { useT } from "../../i18n/useT";
import { notify } from "../../lib/notify";
import { logError } from "../../lib/log";
import { formatDisplayDate } from "../../utils/formatDate";
import { paperlessDocUrl, paperlessDownload, paperlessThumbnail, receiptFromDownload } from "../../lib/paperless/commands";
import { paperlessErrorKey, type InboxItem } from "../../lib/paperless/inbox";
import { paperlessInboxKey, type PaperlessInbox as Inbox } from "../../db/hooks/usePaperlessInbox";
import { dismissPaperlessDoc, undismissPaperlessDoc } from "../../db/queries/paperlessLinks";
import { useUpdateExpense } from "../../db/hooks/useExpenses";

/** An expense saved from the inbox whose original file could not be downloaded (this session only). */
export interface MissingReceipt {
  connectionId: number;
  docId: number;
  expenseId: number;
  title: string;
  /** The expense's reference and supplier, for the receipt's file name. */
  reference: string;
  supplier: string;
}

/**
 * The "To file" tab of the Expenses page: Paperless supplier invoices not yet
 * booked. "Create expense" only opens the expense form (prefilled); nothing is
 * booked until the form is saved.
 */
export function PaperlessInbox({
  inbox,
  missing,
  onMissingResolved,
  onCreate,
}: {
  inbox: Inbox;
  missing: MissingReceipt[];
  onMissingResolved: (docId: number) => void;
  /** Open the expense form for the item; `receiptPath` is undefined when the download failed. */
  onCreate: (item: InboxItem, receiptPath: string | undefined) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const updateExpense = useUpdateExpense();
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const rows = inbox.items.filter((i) => i.state === (showDismissed ? "dismissed" : "new"));
  const invalidate = (connectionId: number) => qc.invalidateQueries({ queryKey: paperlessInboxKey(connectionId) });

  const create = async (item: InboxItem) => {
    setBusy(item.docId);
    let receiptPath: string | undefined;
    try {
      receiptPath = await paperlessDownload(item.connectionId, item.docId);
    } catch (e) {
      // The form still opens: the expense can be booked and the receipt fetched later.
      logError("Paperless download failed:", e);
      notify.warning(t.paperless_download_failed);
    }
    setBusy(null);
    onCreate(item, receiptPath);
  };

  const setDismissed = async (item: InboxItem, dismissed: boolean) => {
    try {
      await (dismissed ? dismissPaperlessDoc : undismissPaperlessDoc)(item.connectionId, item.docId);
      await invalidate(item.connectionId);
    } catch (e) {
      notify.error(t.paperless_dismiss_failed, e);
    }
  };

  const retry = async (m: MissingReceipt) => {
    setBusy(m.docId);
    try {
      const src = await paperlessDownload(m.connectionId, m.docId);
      const dest = await receiptFromDownload(src, m.reference, m.supplier);
      await updateExpense.mutateAsync({ id: m.expenseId, data: { receipt_path: dest } });
      notify.success(t.receipt_attached);
      onMissingResolved(m.docId);
    } catch (e) {
      notify.error(t.paperless_download_failed, e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <FilterChip active={showDismissed} onClick={() => setShowDismissed((v) => !v)}>
          {t.paperless_dismissed}
        </FilterChip>
        <IconButton icon={ICONS.updates} label={t.paperless_refresh} onClick={inbox.refresh} />
      </div>

      {inbox.offline && <Callout tone="warning">{t.paperless_offline}</Callout>}
      {inbox.error && (
        <Callout tone="danger">
          <span title={inbox.error}>{t[paperlessErrorKey(inbox.error)]}</span> {t.paperless_error_hint}
        </Callout>
      )}

      {missing.map((m) => (
        <Callout
          key={`missing-${m.connectionId}-${m.docId}`}
          tone="warning"
          action={
            <Button variant="outline" loading={busy === m.docId} onClick={() => void retry(m)}>
              {t.paperless_receipt_missing_retry}
            </Button>
          }
        >
          {m.reference} {m.supplier} — {m.title}
        </Callout>
      ))}

      {rows.length === 0 && !inbox.error ? (
        <EmptyState
          message={showDismissed ? t.paperless_dismissed_empty : t.paperless_inbox_empty}
          icon={ICONS.expense}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-lg">
          {rows.map((item) => (
            <li key={`${item.connectionId}-${item.docId}`} className="flex items-center gap-3 px-3 py-2">
              <Thumbnail connectionId={item.connectionId} docId={item.docId} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{item.title}</div>
                <div className="text-xs text-muted truncate">
                  {[item.supplier, formatDisplayDate(item.date)].filter(Boolean).join(" · ")}
                </div>
              </div>
              {inbox.connection && (
                <IconButton
                  icon={ICONS.openExternal}
                  label={t.paperless_open}
                  onClick={() => {
                    const { host, port } = inbox.connection!;
                    openUrl(paperlessDocUrl(host, port, item.docId)).catch((e) => notify.error(t.failed_to_open_url, e));
                  }}
                />
              )}
              {showDismissed ? (
                <Button variant="secondary" icon={ICONS.restore} onClick={() => void setDismissed(item, false)}>
                  {t.paperless_restore}
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => void setDismissed(item, true)}>
                    {t.paperless_dismiss}
                  </Button>
                  <Button icon={ICONS.add} loading={busy === item.docId} disabled={busy !== null} onClick={() => void create(item)}>
                    {t.paperless_create_expense}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The document's first page, fetched once per document; nothing when it fails. */
function Thumbnail({ connectionId, docId }: { connectionId: number; docId: number }) {
  const { data } = useQuery({
    queryKey: ["paperless-thumb", connectionId, docId],
    queryFn: () => paperlessThumbnail(connectionId, docId),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <div className="w-10 h-14 shrink-0 rounded bg-[var(--color-input-bg)] overflow-hidden">
      {data && <img src={data} alt="" className="w-full h-full object-cover" />}
    </div>
  );
}
