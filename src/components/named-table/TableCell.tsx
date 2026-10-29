import type { RefObject } from "react";
import { Tag } from "../ui/Tag";
import { Select } from "../ui/Select";
import type { TableColumnDef, ProjectTableRow } from "../../types/project-table";

import { Checkbox, DatePicker, Input, PILL_XS } from "../ui";
interface Props {
  row: ProjectTableRow;
  col: TableColumnDef;
  /** True when this exact (row, col) pair is the one being edited. */
  isEditing: boolean;
  editValue: string;
  cellInputRef: RefObject<HTMLInputElement | null>;
  onStartEdit: () => void;
  onEditValueChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  /** Replaces the row's full `data` object (mirrors updateRow.mutate({ id, data })). */
  onChange: (data: Record<string, unknown>) => void;
}

/** Renders one table cell, dispatching on the column type — text, number,
 * checkbox, select, tags (linked-list), and date. Extracted verbatim out of
 * NamedTable's `renderCell`; every branch keeps its original markup and
 * handler logic, just fed through props instead of closures. */
export function TableCell({
  row,
  col,
  isEditing,
  editValue,
  cellInputRef,
  onStartEdit,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  onChange,
}: Props) {
  switch (col.type) {
    case "checkbox":
      return (
        <Checkbox
          checked={!!row.data[col.id]}
          onChange={() => onChange({ ...row.data, [col.id]: !row.data[col.id] })}
          aria-label={col.name}
        />
      );
    case "select":
      return (
        <Select
          value={(row.data[col.id] as string) ?? ""}
          onChange={(e) => onChange({ ...row.data, [col.id]: e.target.value })}
          variant="bare"
          fullWidth={false}
          aria-label={col.name}
        >
          <option value="">—</option>
          {(col.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </Select>
      );
    case "tags": {
      const selected = (row.data[col.id] as string[] | undefined) ?? [];
      const available = (col.options ?? []).filter((o) => !selected.includes(o));
      const addTag = (tag: string) => {
        onChange({ ...row.data, [col.id]: [...selected, tag] });
      };
      const removeTag = (tag: string) => {
        onChange({ ...row.data, [col.id]: selected.filter((tg) => tg !== tag) });
      };
      return (
        <div className="flex flex-wrap gap-1 items-center">
          {selected.map((tag) => (
            <Tag key={tag} name={tag} size="xs" onRemove={() => removeTag(tag)} />
          ))}
          {available.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => addTag(opt)}
              // The same 16px pill as the Tag beside it (PILL_XS), neutral until hovered
              className={`${PILL_XS} bg-[var(--color-input-bg)] text-muted hover:text-accent-text hover:bg-accent-light focus-accent transition-colors`}
            >
              + {opt}
            </button>
          ))}
        </div>
      );
    }
    case "date":
      return (
        <DatePicker variant="bare" fullWidth={false}
          value={(row.data[col.id] as string) || null}
          onChange={(v) => onChange({ ...row.data, [col.id]: v ?? "" })}
          aria-label={col.name}
        />
      );
    default:
      if (isEditing) {
        return (
          <Input variant="inline"
            ref={cellInputRef}
            type={col.type === "number" ? "number" : "text"}
            numeric={col.type === "number"}
            aria-label={col.name}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
          />
        );
      }
      return (
        <span
          className="cursor-pointer hover:text-accent-text block truncate"
          onDoubleClick={onStartEdit}
        >
          {row.data[col.id] != null ? String(row.data[col.id]) : <span className="text-muted">—</span>}
        </span>
      );
  }
}
