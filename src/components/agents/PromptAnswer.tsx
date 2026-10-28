import { useEffect, useRef, useState } from "react";
import { answerPrompt, getPrompt, type Prompt } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Button } from "../ui";

const POLL_MS = 2000;
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
  const [error, setError] = useState<string | null>(null);
  const answeringRef = useRef(false);
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
    setError(null);
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
    };
  }, [shortId]);

  const answer = async (number: number, label: string) => {
    if (!prompt || answeringRef.current) return;
    answeringRef.current = true;
    const mine = gen.current;
    answers.current++;
    setAnswering(true);
    setError(null);
    try {
      await answerPrompt(shortId, number, label, prompt.fingerprint);
    } catch (e) {
      if (gen.current === mine) setError(String(e));
    } finally {
      answeringRef.current = false;
      if (gen.current === mine) setAnswering(false);
    }
    if (gen.current === mine) pollRef.current();
  };

  if (!loaded) return null;

  const terminalHint = (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted">{t.agents_answer_in_terminal}</span>
      <Button variant="ghost" size="sm" onClick={() => onOpenTerminal(shortId)}>
        {t.agents_open_terminal}
      </Button>
    </div>
  );

  if (!prompt) return <div className="rounded-lg border border-[var(--color-border)] p-3">{terminalHint}</div>;

  const buttons = prompt.options.filter((o) => !TERMINAL_ONLY.has(o.label.trim().toLowerCase()));
  const hasTerminalOnly = buttons.length < prompt.options.length || buttons.length === 0;

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
      {prompt.detail && (
        <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-[var(--color-input-bg)] rounded-md p-2">
          {prompt.detail}
        </pre>
      )}
      <p className="text-sm font-medium">{prompt.question}</p>
      <div className="flex flex-wrap gap-2">
        {buttons.map((o) => (
          <Button
            key={o.number}
            variant={o.selected ? "primary" : "ghost"}
            size="sm"
            disabled={answering}
            onClick={() => void answer(o.number, o.label)}
          >
            {o.number}. {o.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger-text)]">
          {error}
        </p>
      )}
      {hasTerminalOnly && terminalHint}
    </div>
  );
}
