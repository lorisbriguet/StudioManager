import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ICONS } from "./icons";
import { Input } from "./Input";
import { IconButton } from "./IconButton";
import { useDraftStore } from "../../stores/draft-store";

/**
 * AddRow — a field and a "+" that add an item to the list above.
 * See DESIGN-SYSTEM.md, "Inputs".
 *
 *   <AddRow placeholder={t.new_task} onAdd={(title) => createTask(title)} />
 *   <AddRow placeholder={t.new_option} size="xs" onAdd={add}>
 *     <TagColorSelect value={color} onChange={setColor} />         extra controls sit before the "+"
 *   </AddRow>
 *
 * Enter or "+" calls `onAdd` with the trimmed text (never empty). Enter doesn't
 * submit a surrounding form. The field clears after the add: right away, or
 * once a returned promise resolves; return `false` to keep the text (a duplicate).
 * `placeholder` is also the field's and the button's accessible name.
 *
 * `draftKey` keeps the typed text (in memory) when the row unmounts, so it is
 * back on return; Esc clears it. Without it the text is local to the row.
 */

interface AddRowProps {
  onAdd: (text: string) => void | boolean | Promise<unknown>;
  placeholder: string;
  /** The "+" button's label, when it differs from the placeholder. */
  buttonLabel?: string;
  /** The "+" button: sm (26px, beside a form field) or xs (20px, in dense lists). */
  size?: "xs" | "sm";
  /** Controls between the field and the "+" (a colour select). */
  children?: ReactNode;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Runs after AddRow's own Enter handling (Esc to close, for one). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Keeps the unsent text under this key in the draft store; Esc clears it. */
  draftKey?: string;
  /** On the row: margins. */
  className?: string;
  "data-testid"?: string;
}

export function AddRow({
  onAdd,
  placeholder,
  buttonLabel,
  size = "sm",
  children,
  autoFocus,
  disabled,
  onKeyDown,
  draftKey,
  className = "",
  "data-testid": testId,
}: AddRowProps) {
  const [local, setLocal] = useState("");
  const stored = useDraftStore((s) => (draftKey ? s.drafts[draftKey] ?? "" : ""));
  const text = draftKey ? stored : local;
  const setText = (value: string) => (draftKey ? useDraftStore.getState().set(draftKey, value) : setLocal(value));
  /** Empties the field unless the user typed more since `sent`. */
  const clearIfUnchanged = (sent: string) => {
    if (draftKey) useDraftStore.getState().clearIf(draftKey, sent);
    else setLocal((cur) => (cur === sent ? "" : cur));
  };

  const add = () => {
    const value = text.trim();
    if (!value || disabled) return;
    const result = onAdd(value);
    if (result === false) return;
    if (result instanceof Promise) {
      result.then(() => clearIfUnchanged(text), () => {});
    } else {
      setText("");
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Escape" && draftKey && text) {
            setText("");
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        fullWidth={false}
        className="flex-1 min-w-0"
        data-testid={testId}
      />
      {children}
      <IconButton
        icon={ICONS.add}
        label={buttonLabel ?? placeholder}
        size={size}
        tone="accent"
        disabled={disabled}
        onClick={add}
      />
    </div>
  );
}
