import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../i18n/useT";
import { useAddDecision, useAnswerEntry, useDismissEntry } from "../../db/hooks/useNeedsYou";
import type { NeedsYouEntry } from "../../db/queries/needsYou";
import { sendMessage } from "../../lib/agents";
import { logError } from "../../lib/log";
import { formatDisplayDateTime } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import { Button, Callout, Textarea } from "../ui";

/** What an agent is told when Loris answers its question. */
const ANSWER_PREFIX = "Answer to your question: ";

/** The options as a list of words; anything else is no options. */
export function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
  } catch {
    return [];
  }
}

/**
 * A question an agent asked, waiting on Loris: the recommendation and its reason, one button per
 * option, or an answer in words. The answer is typed into the agent, then the entry is answered
 * (and written to the project's Decisions when it is a decision). A refused send keeps the entry.
 */
export function DecideEntry({ entry: e }: { entry: NeedsYouEntry }) {
  const t = useT();
  const answerEntry = useAnswerEntry();
  const addDecision = useAddDecision();
  const dismiss = useDismissEntry();
  const [words, setWords] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  // The answer reached the agent but could not be saved: only the saving is retried, never the send.
  const [recordFailed, setRecordFailed] = useState(false);
  const sent = useRef<string | null>(null);
  const options = parseOptions(e.options);
  // An agent waiting at a prompt is answered in the agent itself; an entry with no agent and no
  // options (the app could not start a worker) only says what happened.
  const simple = e.lead_state === "prompt" || (e.link_id == null && options.length === 0);

  const record = async (answer: string) => {
    try {
      await answerEntry.mutateAsync({ id: e.id, answer, delivered: e.link_id != null });
    } catch (err) {
      setRecordFailed(true);
      void logError(`Needs you ${e.id}: recording the answer failed:`, err);
      return;
    }
    setRecordFailed(false);
    if (e.is_decision && e.project_id != null) {
      addDecision.mutate({ projectId: e.project_id, date: todayLocalISO(), text: `${e.body}: ${answer}` });
    }
  };

  const answer = async (text: string) => {
    const answer = text.trim();
    if (!answer || sending || recordFailed) return;
    setSending(true);
    setError(false);
    try {
      // An entry with no link (asked outside a worker) is only recorded; a link needs its session.
      if (e.link_id != null) {
        if (!e.session_id) throw new Error("the agent has no session");
        await sendMessage(e.session_id, ANSWER_PREFIX + answer);
      }
      sent.current = answer;
    } catch (err) {
      setError(true);
      void logError(`Needs you ${e.id}: send failed:`, err);
      setSending(false);
      return;
    }
    await record(answer);
    setSending(false);
  };

  const retryRecord = async () => {
    if (sending || sent.current == null) return;
    setSending(true);
    await record(sent.current);
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
      <p className="mt-1 text-sm font-medium whitespace-pre-wrap">{e.body}</p>
      {e.recommendation && (
        <p className="mt-1 text-sm">
          <span className="font-medium">{t.decide_recommended.replace("{text}", e.recommendation)}</span>
          {e.reason && <span className="text-muted"> {e.reason}</span>}
        </p>
      )}
      {!e.recommendation && e.reason && <p className="mt-1 text-sm text-muted">{e.reason}</p>}
      {e.lead_state === "done" && <p className="text-xs text-muted">{t.decide_from_lead}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!simple &&
          options.map((o) => (
            <Button
              key={o}
              variant={o === e.recommendation ? "primary" : "secondary"}
              disabled={sending || recordFailed}
              onClick={() => void answer(o)}
            >
              {o}
            </Button>
          ))}
        {e.session_id && (
          <Link to={`/agents?agent=${e.session_id}`} className="text-sm text-accent-text hover:underline">
            {t.decide_open_agent}
          </Link>
        )}
        {simple ? (
          <Button variant="secondary" onClick={() => dismiss.mutate(e.id)}>
            {t.decide_dismiss}
          </Button>
        ) : (
          <Button variant="secondary" aria-expanded={words} onClick={() => setWords(!words)}>
            {t.decide_answer_words}
          </Button>
        )}
      </div>
      {words && !simple && (
        <div className="mt-2 flex flex-col items-start gap-2">
          <Textarea
            aria-label={t.decide_answer_words}
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault();
                void answer(draft);
              }
            }}
          />
          <Button disabled={sending || recordFailed || !draft.trim()} onClick={() => void answer(draft)}>
            {t.decide_send_answer}
          </Button>
        </div>
      )}
      {recordFailed && (
        <div className="mt-2">
          <Callout tone="danger">{t.decide_record_failed}</Callout>
          <Button variant="secondary" className="mt-2" disabled={sending} onClick={() => void retryRecord()}>
            {t.decide_retry_record}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Callout tone="danger">{t.agents_send_failed}</Callout>
          <Button variant="secondary" className="mt-2" onClick={() => dismiss.mutate(e.id)}>
            {t.decide_dismiss}
          </Button>
        </div>
      )}
    </li>
  );
}
