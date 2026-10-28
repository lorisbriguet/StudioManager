import { useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { dismissAgent, deleteAgent, sendMessage, stopAgent, switchModel, type Agent } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Button, Select } from "../ui";
import { agentLabel, GROUP_LABEL_KEYS, GROUP_STYLE } from "./AgentList";
import { Conversation } from "./Conversation";
import { PromptAnswer } from "./PromptAnswer";

const MODELS = ["haiku", "sonnet", "opus", "fable"];

interface AgentDetailProps {
  agent: Agent;
  onOpenTerminal: (shortId: string) => void;
  /** Called after the agent was deleted. */
  onDeleted?: () => void;
  /** Called with the short id of the new agent after a model switch. */
  onSwitched?: (shortId: string) => void;
}

export function AgentDetail({ agent, onOpenTerminal, onDeleted, onSwitched }: AgentDetailProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const background = agent.kind === "background";
  const canSend = background && agent.status !== "waiting";
  const shortId = agent.shortId;
  const knownModel = MODELS.includes(agent.model ?? "");

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !canSend || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(agent.sessionId, body);
      setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!shortId || !(await ask(t.agents_stop_confirm, { kind: "warning" }))) return;
    await run(() => stopAgent(shortId));
  };

  const remove = async () => {
    if (!shortId || !(await ask(t.agents_delete_confirm, { kind: "warning" }))) return;
    await run(async () => {
      await deleteAgent(shortId);
      onDeleted?.();
    });
  };

  const disabledReason = !background
    ? t.agents_message_disabled_interactive
    : agent.status === "waiting"
      ? t.agents_message_disabled_waiting
      : null;

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold truncate">{agent.name}</h2>
          <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${GROUP_STYLE[agent.group].pill}`}>
            <span className={`dot-sm ${GROUP_STYLE[agent.group].dot}`} aria-hidden />
            {t[GROUP_LABEL_KEYS[agent.group]]}
          </span>
        </div>
        <div className="text-sm text-muted">{agentLabel(agent)}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!shortId} onClick={() => void stop()}>
          {t.agents_stop}
        </Button>
        <Button variant="danger" size="sm" disabled={!shortId} onClick={() => void remove()}>
          {t.agents_delete}
        </Button>
        {agent.group === "needs-you" && (
          <Button variant="ghost" size="sm" onClick={() => void run(() => dismissAgent(agent.sessionId))}>
            {t.agents_dismiss}
          </Button>
        )}
        {shortId && (
          <Button variant="ghost" size="sm" onClick={() => onOpenTerminal(shortId)}>
            {t.agents_open_terminal}
          </Button>
        )}
        {background && (
          <Select
            fullWidth={false}
            className="w-32"
            aria-label={t.agents_model}
            value={knownModel ? (agent.model as string) : ""}
            onChange={(e) => void run(async () => {
                const next = await switchModel(agent.sessionId, e.target.value);
                onSwitched?.(next);
              })}
          >
            {!knownModel && <option value="" disabled />}
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger-text)]">
          {error}
        </p>
      )}

      {agent.group === "needs-you" && background && shortId && (
        <PromptAnswer shortId={shortId} onOpenTerminal={onOpenTerminal} />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Conversation sessionId={agent.sessionId} working={agent.group === "working"} />
      </div>

      <div className="max-w-3xl w-full mx-auto space-y-1.5">
        <div
          className={`flex items-end gap-2 rounded-xl border border-[var(--color-input-border)] bg-[var(--color-surface)] pl-4 pr-2 py-2 shadow-sm focus-within:border-[var(--color-accent)] ${
            canSend ? "" : "opacity-60"
          }`}
        >
          <textarea
            value={text}
            rows={1}
            maxLength={20000}
            disabled={!canSend}
            placeholder={t.agents_message_placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line (IME composition left alone).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            style={{ fieldSizing: "content" } as React.CSSProperties}
            className="flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none min-h-[2rem] max-h-48 overflow-y-auto"
          />
          <button
            type="button"
            aria-label={t.agents_send}
            disabled={!canSend || sending || text.trim() === ""}
            onClick={() => void send()}
            className="shrink-0 grid place-items-center size-8 rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
        {disabledReason && <p className="text-xs text-muted text-center">{disabledReason}</p>}
      </div>
    </div>
  );
}
