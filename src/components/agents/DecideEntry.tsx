import { useState } from "react";
import { useT } from "../../i18n/useT";
import { useAddDecision, useAnswerEntry } from "../../db/hooks/useNeedsYou";
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
  const [words, setWords] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const options = parseOptions(e.options);

  const answer = async (text: string) => {
    const answer = text.trim();
    if (!answer || sending) return;
    setSending(true);
    setError(false);
    try {
      // An entry with no agent session (asked outside a linked worker) is only recorded.
      if (e.session_id) await sendMessage(e.session_id, ANSWER_PREFIX + answer);
    } catch (err) {
      setError(true);
      void logError(`Needs you ${e.id}: send failed:`, err);
      setSending(false);
      return;
    }
    answerEntry.mutate({ id: e.id, answer });
    if (e.is_decision && e.project_id != null) {
      addDecision.mutate({ projectId: e.project_id, date: todayLocalISO(), text: `${e.body}: ${answer}` });
    }
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
      {e.lead_state && <p className="text-xs text-muted">{t.decide_from_lead}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {options.map((o) => (
          <Button
            key={o}
            variant={o === e.recommendation ? "primary" : "secondary"}
            disabled={sending}
            onClick={() => void answer(o)}
          >
            {o}
          </Button>
        ))}
        <Button variant="secondary" aria-expanded={words} onClick={() => setWords(!words)}>
          {t.decide_answer_words}
        </Button>
      </div>
      {words && (
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
          <Button disabled={sending || !draft.trim()} onClick={() => void answer(draft)}>
            {t.decide_send_answer}
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
