import { useEffect, useRef, useState } from "react";
import { answerPrompt, getPrompt, type Prompt } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Button, Callout, Card } from "../ui";
import { logError } from "../../lib/log";

const POLL_MS = 2000;
/**
 * After an answer, the screen shows the same question until the agent redraws, and the read
 * right after the Enter still sees it. Its buttons stay off that long, at most this long: if
 * the question is still there by then, the answer did not land and it can be answered again.
 */
const ANSWERED_HOLD_MS = 8000;
// Free-text and chat entries of a question: only the terminal can answer these.
const TERMINAL_ONLY = new Set(["type something.", "type something", "chat about this"]);

interface PromptAnswerProps {
  shortId: string;
  onOpenTerminal: (shortId: string) => void;
}

export function PromptAnswer({ shortId, onOpenTerminal }: PromptAnswerProps) {
  const t = useT();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Fingerprint of the prompt just answered, while the screen may still show it. */
  const [answered, setAnswered] = useState<string | null>(null);
  const answeringRef = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  // gen: bumped when the agent changes. answers: bumped per answer, so a poll that
  // started before an answer cannot overwrite what follows it.
  const gen = useRef(0);
  const answers = useRef(0);
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    const genCounter = gen; // the ref object itself never changes
    const myGen = ++genCounter.current;
    let inflight = false;
    const current = () => gen.current === myGen;
    setPrompt(null);
    setLoaded(false);
    setFailed(false);
    setAnswered(null);
    const poll = () => {
      if (inflight || answeringRef.current) return;
      inflight = true;
      const startAnswers = answers.current;
      getPrompt(shortId)
        .catch(() => null)
        .then((p) => {
          if (current() && answers.current === startAnswers && !answeringRef.current) {
            setPrompt(p);
            setLoaded(true);
            // Another prompt, or none: the one answered is gone.
            setAnswered((a) => (a !== null && a === p?.fingerprint ? a : null));
          }
        })
        .finally(() => {
          inflight = false;
        });
    };
    pollRef.current = poll;
    poll();
    // Polls only while mounted, and not while an answer is in flight.
    const timer = setInterval(poll, POLL_MS);
    return () => {
      genCounter.current++;
      clearInterval(timer);
      window.clearTimeout(holdTimer.current);
    };
  }, [shortId]);

  const answer = async (number: number, label: string) => {
    if (!prompt || answeringRef.current || answered === prompt.fingerprint) return;
    answeringRef.current = true;
    const mine = gen.current;
    answers.current++;
    setAnswering(true);
    setFailed(false);
    try {
      await answerPrompt(shortId, number, label, prompt.fingerprint);
      if (gen.current === mine) {
        setAnswered(prompt.fingerprint);
        window.clearTimeout(holdTimer.current);
        holdTimer.current = window.setTimeout(() => {
          if (gen.current === mine) setAnswered(null);
        }, ANSWERED_HOLD_MS);
      }
    } catch (e) {
      void logError(`Agent ${shortId}: answer failed:`, e);
      if (gen.current === mine) setFailed(true);
    } finally {
      answeringRef.current = false;
      if (gen.current === mine) setAnswering(false);
    }
    if (gen.current === mine) pollRef.current();
  };

  const terminalHint = (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted">{t.agents_answer_in_terminal}</span>
      <Button variant="outline" onClick={() => onOpenTerminal(shortId)}>
        {t.agents_open_terminal}
      </Button>
    </div>
  );

  const buttons = prompt ? prompt.options.filter((o) => !TERMINAL_ONLY.has(o.label.trim().toLowerCase())) : [];
  const hasTerminalOnly = !prompt || buttons.length < prompt.options.length || buttons.length === 0;

  // A live region that stays mounted from the first render, so the question is read out
  // when it arrives or changes (a region inserted along with its content is often not announced).
  return (
    <div role="log" aria-live="polite" aria-label={t.agents_group_needs_you}>
      {loaded && !prompt && (
        <Card tone="inset" padding="sm">
          {terminalHint}
        </Card>
      )}
      {loaded && prompt && (
        <Card tone="inset" padding="sm" className="space-y-3">
          {prompt.detail && (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-[var(--color-input-bg)] rounded-lg p-2">
              {prompt.detail}
            </pre>
          )}
          <p className="text-sm font-medium">{prompt.question}</p>
          <div className="flex flex-wrap gap-2">
            {buttons.map((o) => (
              <Button
                key={o.number}
                variant={o.selected ? "primary" : "outline"}
                // The terminal's highlighted default: these buttons submit, they are not toggles.
                aria-current={o.selected ? "true" : undefined}
                disabled={answering || answered === prompt.fingerprint}
                onClick={() => void answer(o.number, o.label)}
              >
                {o.number}. {o.label}
                {o.selected && <span className="sr-only"> ({t.agents_prompt_default})</span>}
              </Button>
            ))}
          </div>
          {failed && <Callout tone="danger">{t.agents_answer_failed}</Callout>}
          {hasTerminalOnly && terminalHint}
        </Card>
      )}
    </div>
  );
}
