import { useState } from "react";
import { useT } from "../../i18n/useT";
import { useConfirmStore, type ConfirmOptions, type ConfirmResult } from "../../stores/confirm-store";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";

/**
 * A question before an action: the verb on the button, Cancel focused,
 * Esc and the backdrop cancel. See DESIGN-SYSTEM.md, "Confirmations".
 * Opened with `confirm()` / `useConfirm()` (lib/confirm), rendered by the
 * one <ConfirmHost/> in App.
 */
export function ConfirmDialog({
  options,
  onAnswer,
}: {
  options: ConfirmOptions;
  onAnswer: (value: ConfirmResult) => void;
}) {
  const t = useT();
  const { title, message, confirmLabel, cancelLabel, tone = "default", requireText, extra } = options;
  const [typed, setTyped] = useState("");
  const blocked = requireText !== undefined && typed.trim() !== requireText;

  return (
    <Modal
      open
      size="sm"
      title={title}
      onClose={() => onAnswer(false)}
      footer={
        <>
          {/* Cancel takes the focus, so a stray Enter never runs the action.
              With a text to type, the field takes it instead. */}
          <Button variant="secondary" autoFocus={requireText === undefined} onClick={() => onAnswer(false)}>
            {cancelLabel ?? t.cancel}
          </Button>
          {extra && (
            <Button variant="outline" onClick={() => onAnswer(extra.value)}>
              {extra.label}
            </Button>
          )}
          <Button variant={tone === "danger" ? "danger" : "primary"} disabled={blocked} onClick={() => onAnswer(true)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <div className="text-sm text-[var(--color-text-secondary)]">{message}</div>}
      {requireText !== undefined && (
        <Input
          className={message ? "mt-3" : ""}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !blocked) onAnswer(true);
          }}
          placeholder={requireText}
          aria-label={title}
          autoFocus
        />
      )}
    </Modal>
  );
}

/** Mount once (App): shows the confirmations asked with `confirm()`, one at a time. */
export function ConfirmHost() {
  const current = useConfirmStore((s) => s.queue[0]);
  const answer = useConfirmStore((s) => s.answer);
  if (!current) return null;
  // key: a new question gets a fresh dialog (empty typed text, focus on Cancel).
  return <ConfirmDialog key={current.id} options={current.options} onAnswer={(v) => answer(current.id, v)} />;
}
