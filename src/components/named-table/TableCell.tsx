import type { RefObject } from "react";
import { X } from "lucide-react";
import { getTagColor } from "../../lib/tagColors";
import type { TableColumnDef, ProjectTableRow } from "../../types/project-table";

interface Props {
  row: ProjectTableRow;
  col: TableColumnDef;
  darkMode: boolean;
  t: Record<string, string>;
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
  darkMode,
  t,
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
        <input
          type="checkbox"
          checked={!!row.data[col.id]}
          onChange={() => onChange({ ...row.data, [col.id]: !row.data[col.id] })}
          className="accent-[var(--accent)]"
        />
      );
    case "select":
      return (
        <select
          value={(row.data[col.id] as string) ?? ""}
          onChange={(e) => onChange({ ...row.data, [col.id]: e.target.value })}
          className="text-xs bg-transparent border-0 outline-none cursor-pointer"
        >
          <option value="">—</option>
          {(col.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
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
          {selected.map((tag) => {
            const color = getTagColor(tag, darkMode);
            return (
              <span
                key={tag}
                style={{ background: color.bg, color: color.text }}
                className="px-1.5 py-0.5 text-[10px] rounded-full flex items-center gap-0.5"
              >
                {tag}
                <button type="button" onClick={() => removeTag(tag)} aria-label={`${t.remove_tag} ${tag}`} className="hover:text-danger">
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {available.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => addTag(opt)}
              className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-input-bg)] text-muted hover:text-accent hover:bg-accent-light transition-colors"
            >
              + {opt}
            </button>
          ))}
        </div>
      );
    }
    case "date":
      return (
        <input
          type="date"
          value={(row.data[col.id] as string) ?? ""}
          onChange={(e) => onChange({ ...row.data, [col.id]: e.target.value })}
          className="text-xs bg-transparent border-0 outline-none"
        />
      );
    default:
      if (isEditing) {
        return (
          <input
            ref={cellInputRef}
            type={col.type === "number" ? "number" : "text"}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
            className="w-full bg-transparent border-b border-accent outline-none text-sm"
          />
        );
      }
      return (
        <span
          className="cursor-pointer hover:text-accent block truncate"
          onDoubleClick={onStartEdit}
        >
          {row.data[col.id] != null ? String(row.data[col.id]) : <span className="text-muted">—</span>}
        </span>
      );
  }
}
