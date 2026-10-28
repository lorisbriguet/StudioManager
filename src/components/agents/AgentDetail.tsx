import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { dismissAgent, deleteAgent, sendMessage, stopAgent, switchModel, type Agent } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Badge, Button, PANEL_TOP_BAR, Select } from "../ui";
import { agentLabel, GROUP_LABEL_KEYS, GROUP_STYLE, GROUP_VARIANT } from "./AgentList";
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
    <div className="flex flex-col h-full min-h-0">
      <div className={`${PANEL_TOP_BAR} gap-2 px-4 border-[var(--color-border-divider)]`}>
        <h2 className="text-sm font-semibold tracking-tight truncate">{agent.name}</h2>
        <Badge variant={GROUP_VARIANT[agent.group]} className="shrink-0 gap-1.5">
          <span className={`dot-sm ${GROUP_STYLE[agent.group].dot}`} aria-hidden />
          {t[GROUP_LABEL_KEYS[agent.group]]}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
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
      </div>
      <div className="px-4 pt-3 text-xs text-muted">{agentLabel(agent)}</div>

      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </p>
      )}

      {agent.group === "needs-you" && background && shortId && (
        <div className="px-4 pt-3">
          <PromptAnswer shortId={shortId} onOpenTerminal={onOpenTerminal} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Conversation sessionId={agent.sessionId} working={agent.group === "working"} />
      </div>

      <div className="max-w-3xl w-full mx-auto space-y-1.5 px-4 pb-4">
        <div
          className="flex items-end gap-2 rounded-xl border border-[var(--color-input-border)] bg-[var(--color-input-bg)] pl-4 pr-2 py-2 focus-within:border-[var(--color-accent)]"
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
            className="flex-1 resize-none bg-transparent! border-0 p-0 py-1.5 text-sm leading-relaxed outline-none min-h-[2rem] max-h-48 overflow-y-auto placeholder:text-muted disabled:cursor-not-allowed disabled:placeholder:opacity-50"
          />
          <Button
            size="sm"
            className="shrink-0 size-8 justify-center"
            aria-label={t.agents_send}
            icon={<ArrowUp size={16} />}
            loading={sending}
            disabled={!canSend || text.trim() === ""}
            onClick={() => void send()}
          />
        </div>
        {disabledReason && <p className="text-xs text-muted text-center">{disabledReason}</p>}
      </div>
    </div>
  );
}
