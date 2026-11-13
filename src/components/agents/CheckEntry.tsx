import { useState } from "react";
import { useT } from "../../i18n/useT";
import { useAnswerEntry, useSendBack } from "../../db/hooks/useNeedsYou";
import { useAcceptResult } from "../../db/hooks/useTaskAgents";
import type { NeedsYouEntry } from "../../db/queries/needsYou";
import { sendMessage } from "../../lib/agents";
import { logError } from "../../lib/log";
import { formatDisplayDateTime } from "../../utils/formatDate";
import { Button, Callout, Textarea } from "../ui";
import { ExternalLink } from "./ExternalLink";

/** What the change touches, from the stored JSON list. */
function parseTouches(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Finished work waiting on Loris (a reopened one too): the result, the size of the change, the
 * check and what it touches. Accept it, open its pull request, or send it back with a note typed
 * into the worker.
 */
export function CheckEntry({ entry: e }: { entry: NeedsYouEntry }) {
  const t = useT();
  const accept = useAcceptResult();
  const answerEntry = useAnswerEntry();
  const sendBack = useSendBack();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const kind = e.subtask_id != null ? "subtask" : "task";
  const itemId = e.subtask_id ?? e.task_id;
  const touches = parseTouches(e.touches);

  const lines =
    e.change_lines == null ? null : e.change_lines === 1 ? t.check_changed_line : t.check_changed_lines.replace("{n}", String(e.change_lines));
  const checked = e.check_passed === 1 ? t.check_passed : e.check_passed === 0 ? t.check_failed : t.check_none;
  const facts = [lines, checked, touches.length > 0 ? t.check_touches.replace("{list}", touches.join(", ")) : null].filter(Boolean);

  const onAccept = () => {
    if (itemId == null) return;
    accept.mutate({ kind, id: itemId });
    answerEntry.mutate({ id: e.id, answer: t.check_accepted });
  };

  const onSendBack = async () => {
    const text = note.trim();
    if (!text || sending || itemId == null) return;
    setSending(true);
    setError(false);
    try {
      if (e.session_id) await sendMessage(e.session_id, text);
    } catch (err) {
      setError(true);
      void logError(`Needs you ${e.id}: send back failed:`, err);
      setSending(false);
      return;
    }
    sendBack.mutate({ kind, id: itemId, entryId: e.id, note: text });
    setSending(false);
  };

  return (
    <li className="px-2 py-3 border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {e.project_name && (
          <>
            <span>{e.project_name}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span>{e.item_title ?? e.title}</span>
        <span aria-hidden>·</span>
        <span>{formatDisplayDateTime(e.created_at)}</span>
      </div>
      <p className="mt-1 text-sm font-medium whitespace-pre-wrap">{e.body || e.title}</p>
      <p className="mt-1 text-xs text-muted">{facts.join(" · ")}</p>
      {e.reason && <p className="text-xs text-muted whitespace-pre-wrap">{e.reason}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={onAccept}>{t.check_accept}</Button>
        {e.pr_url && (
          <ExternalLink href={e.pr_url} className="text-sm text-accent-text hover:underline">
            {t.check_open_pr}
          </ExternalLink>
        )}
        <Button variant="secondary" aria-expanded={noting} onClick={() => setNoting(!noting)}>
          {t.check_send_back}
        </Button>
      </div>
      {noting && (
        <div className="mt-2 flex flex-col items-start gap-2">
          <Textarea aria-label={t.check_note_label} value={note} onChange={(ev) => setNote(ev.target.value)} />
          <Button disabled={sending || !note.trim()} onClick={() => void onSendBack()}>
            {t.check_send_note}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Callout tone="danger">{t.agents_send_failed}</Callout>
        </div>
      )}
    </li>
  );
}
