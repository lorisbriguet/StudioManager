import { useCallback, useEffect, useRef, useState } from "react";
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
  const alive = useRef(true);

  const poll = useCallback(async () => {
    try {
      const p = await getPrompt(shortId);
      if (alive.current && !answeringRef.current) setPrompt(p);
    } catch {
      if (alive.current && !answeringRef.current) setPrompt(null);
    }
    if (alive.current) setLoaded(true);
  }, [shortId]);

  useEffect(() => {
    alive.current = true;
    setPrompt(null);
    setLoaded(false);
    void poll();
    // Polls only while mounted, and not while an answer is in flight.
    const timer = setInterval(() => {
      if (!answeringRef.current) void poll();
    }, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [poll]);

  const answer = async (number: number, label: string) => {
    if (!prompt || answeringRef.current) return;
    answeringRef.current = true;
    setAnswering(true);
    setError(null);
    try {
      await answerPrompt(shortId, number, label, prompt.fingerprint);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      answeringRef.current = false;
      if (alive.current) setAnswering(false);
    }
    void poll();
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
