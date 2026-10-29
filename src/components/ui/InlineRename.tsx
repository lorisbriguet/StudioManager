import { useId, useRef, useState } from "react";
import { Input } from "./Input";
import { FieldError } from "./FormField";

/**
 * InlineRename — the name of a row, edited in place. See DESIGN-SYSTEM.md, "Inputs".
 *
 *   {editing ? (
 *     <InlineRename value={list.name} label={t.rename} className="flex-1 text-xs"
 *       onSave={(name) => { rename(name); setEditing(false); }}
 *       onCancel={() => setEditing(false)} />
 *   ) : <span onDoubleClick={() => setEditing(true)}>{list.name}</span>}
 *
 * Opens focused with the text selected, and keeps the row's text size and weight
 * (pass them in `className`; the field inherits the font).
 * - Enter and blur save: `onSave(name)` gets the trimmed name. The caller saves
 *   and closes the field; it stays open (with `error`) when saving fails.
 * - An empty or unchanged name, or Esc, calls `onCancel` instead.
 * - `validate(name)` returns an error to show (and keeps the field open), or nothing.
 */

interface InlineRenameProps {
  value: string;
  onSave: (name: string) => void | Promise<void>;
  onCancel: () => void;
  /** The field's accessible name ("Rename"). */
  label: string;
  /** Checked on save, before the empty and unchanged checks. */
  validate?: (name: string) => string | null | undefined;
  /** An error from outside (a failed save). */
  error?: string | null;
  /** Fires on every keystroke; clear an outside error here. */
  onChange?: (draft: string) => void;
  /** On the wrapper: width (flex-1) and the row's text size / weight. */
  className?: string;
  "data-testid"?: string;
}

export function InlineRename({
  value,
  onSave,
  onCancel,
  label,
  validate,
  error,
  onChange,
  className = "",
  "data-testid": testId,
}: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  const [ownError, setOwnError] = useState<string | null>(null);
  // Set once Enter or Esc settled the field, so the blur that follows doesn't settle it again.
  const settled = useRef(false);
  const errorId = useId();
  const shown = ownError ?? error ?? null;

  const commit = () => {
    if (settled.current) return;
    const name = draft.trim();
    const invalid = validate?.(name);
    if (invalid) {
      setOwnError(invalid);
      return;
    }
    settled.current = true;
    if (!name || name === value) {
      onCancel();
      return;
    }
    // The caller closes the field. If it stays open (the save failed), allow another try.
    void Promise.resolve(onSave(name))
      .catch(() => {})
      .finally(() => {
        settled.current = false;
      });
  };

  return (
    <span className={`flex flex-col min-w-0 ${className}`.trim()}>
      <Input
        variant="inline"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={draft}
        onChange={(e) => {
          settled.current = false;
          setDraft(e.target.value);
          setOwnError(null);
          onChange?.(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Don't submit a surrounding form, don't toggle the row.
            e.preventDefault();
            e.stopPropagation();
            commit();
          } else if (e.key === "Escape") {
            // Close the field, not the dialog it sits in.
            e.preventDefault();
            e.stopPropagation();
            settled.current = true;
            onCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label={label}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? errorId : undefined}
        data-testid={testId}
      />
      {shown && <FieldError id={errorId}>{shown}</FieldError>}
    </span>
  );
}
