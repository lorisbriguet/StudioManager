import { useId, useState } from "react";
import { useT } from "../../i18n/useT";
import { Input, Tag, type FieldWidth } from "../ui";

/**
 * TagInput — a record's tags as pills, and a field that adds one.
 * Wiki articles and resources use it. See DESIGN-SYSTEM.md, "Inputs".
 *
 *   <TagInput value={tags} onChange={setTags} suggestions={allTags} />
 *   <TagInput value={tags} onChange={save} lowercase variant="bare" width="sm" readOnly={reading} />
 *
 * Enter or comma adds the trimmed text (never empty, never a duplicate) and
 * doesn't submit a surrounding form. Each pill has a remove button.
 * `suggestions` (minus the tags already set) show as the field's autocomplete.
 * Inside a FormField, the field gets the label's id.
 */

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  /** Store tags in lower case (wiki tags). */
  lowercase?: boolean;
  /** Pills only, no field and no remove buttons. */
  readOnly?: boolean;
  /** bare: no frame until hover/focus (table cells, metadata rows). */
  variant?: "default" | "bare";
  /** The field's width; it fills the rest of the row otherwise. */
  width?: FieldWidth;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  /** On the row of pills (layout). */
  className?: string;
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  lowercase = false,
  readOnly = false,
  variant = "default",
  width,
  placeholder,
  id,
  className = "",
  ...aria
}: TagInputProps) {
  const t = useT();
  const listId = useId();
  const [text, setText] = useState("");
  const open = suggestions.filter((s) => !value.includes(s));

  const add = () => {
    const raw = text.trim();
    const tag = lowercase ? raw.toLowerCase() : raw;
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText("");
  };

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`.trim()}>
      {value.map((tag) => (
        <Tag key={tag} name={tag} onRemove={readOnly ? undefined : () => onChange(value.filter((x) => x !== tag))} />
      ))}
      {!readOnly && (
        <>
          <Input
            id={id}
            type="text"
            variant={variant}
            width={width}
            fullWidth={false}
            className={width ? "" : "flex-1 min-w-24"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder ?? t.add_tag}
            aria-label={aria["aria-label"] ?? (id ? undefined : t.tags)}
            aria-describedby={aria["aria-describedby"]}
            aria-invalid={aria["aria-invalid"]}
            list={open.length > 0 ? listId : undefined}
          />
          {open.length > 0 && (
            <datalist id={listId}>
              {open.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}
