import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { dismissAgent, deleteAgent, sendMessage, stopAgent, switchModel, type Agent } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Button, Select } from "../ui";
import { agentLabel } from "./AgentList";
import { Conversation } from "./Conversation";
import { PromptAnswer } from "./PromptAnswer";

const MODELS = ["haiku", "sonnet", "opus", "fable"];

interface AgentDetailProps {
  agent: Agent;
  onOpenTerminal: (shortId: string) => void;
  /** Called after the agent was deleted. */
  onDeleted?: () => void;
}

export function AgentDetail({ agent, onOpenTerminal, onDeleted }: AgentDetailProps) {
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
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold truncate">{agent.name}</h2>
          <span className="text-sm text-muted">{agent.status}</span>
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
            aria-label={t.agents_model}
            value={knownModel ? (agent.model as string) : ""}
            onChange={(e) => void run(() => switchModel(agent.sessionId, e.target.value))}
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

      <div className="space-y-1">
        <div className="flex gap-2">
          <textarea
            value={text}
            rows={2}
            maxLength={20000}
            disabled={!canSend}
            placeholder={t.agents_message_placeholder}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm focus-accent disabled:opacity-50"
          />
          <Button disabled={!canSend || text.trim() === ""} loading={sending} onClick={() => void send()}>
            {t.agents_send}
          </Button>
        </div>
        {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      </div>
    </div>
  );
}
