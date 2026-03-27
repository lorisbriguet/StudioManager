import { useState, useRef, useEffect, useCallback, memo } from "react";
import { TAG_COLORS, type WorkloadColumn, type SelectOption } from "../../types/workload";
import { SelectTagPicker } from "./SelectTagPicker";
import { evaluateFormula } from "../../lib/formulaEval";

interface Props {
  column: WorkloadColumn;
  value: unknown;
  allCells: Record<string, unknown>;
  onChange: (value: unknown) => void;
  onOptionsChange?: (options: SelectOption[]) => void;
}

export const WorkloadCell = memo(function WorkloadCell({
  column,
  value,
  allCells,
  onChange,
  onOptionsChange,
}: Props) {
  switch (column.type) {
    case "text":
    case "link": // "link" is now just a text column (row IS the task)
      return (
        <TextCell
          value={(value as string) ?? ""}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <NumberCell value={value as number | undefined} onChange={onChange} />
      );
    case "checkbox":
      return (
        <CheckboxCell value={!!value} onChange={onChange} />
      );
    case "select":
    case "multi_select":
      return (
        <SelectCell
          multi={column.type === "multi_select"}
          options={column.options ?? []}
          value={normalizeSelectValue(value, column.type === "multi_select")}
          onChange={onChange}
          onOptionsChange={onOptionsChange}
        />
      );
    case "formula":
      return <FormulaCell formula={column.formula ?? ""} cells={allCells} />;
    default:
      return <span className="text-sm text-muted">-</span>;
  }
});

function normalizeSelectValue(value: unknown, multi: boolean): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string" && value) return [value];
  if (!multi && value) return [String(value)];
  return [];
}

// ── Text Cell ──────────────────────────────────────────────

function TextCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, value]);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft.trim() !== value) onChange(draft.trim());
  }, [draft, value, onChange]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full text-sm border border-[var(--color-border-divider)] rounded-lg px-2 py-0.5 outline-none"
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="block text-sm cursor-text min-h-[28px] leading-[20px] py-1 break-words whitespace-pre-wrap"
    >
      {value || <span className="text-muted">&nbsp;</span>}
    </span>
  );
}

// ── Number Cell ────────────────────────────────────────────

function NumberCell({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(value ?? ""));
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, value]);

  const commit = useCallback(() => {
    setEditing(false);
    const num = parseFloat(draft);
    if (!isNaN(num) && num !== value) onChange(num);
    else if (draft === "" && value !== undefined) onChange(0);
  }, [draft, value, onChange]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="any"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full text-sm border border-[var(--color-border-divider)] rounded-lg px-2 py-0.5 outline-none text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="block text-sm cursor-text text-right min-h-[28px] leading-[28px]"
    >
      {value !== undefined && value !== 0 ? value : <span className="text-muted">&nbsp;</span>}
    </span>
  );
}

// ── Checkbox Cell ──────────────────────────────────────────

function CheckboxCell({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex justify-center items-center min-h-[28px]">
      <input
        type="checkbox"
        checked={value}
        onChange={() => onChange(!value)}
        className="rounded cursor-pointer"
      />
    </div>
  );
}

// ── Select Cell ────────────────────────────────────────────

function SelectCell({
  multi,
  options,
  value,
  onChange,
  onOptionsChange,
}: {
  multi: boolean;
  options: SelectOption[];
  value: string[];
  onChange: (v: string | string[]) => void;
  onOptionsChange?: (options: SelectOption[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={anchorRef} className="relative min-h-[28px] flex items-center flex-wrap gap-1">
      <div
        onClick={() => setOpen(!open)}
        className="flex flex-wrap gap-1 cursor-pointer min-w-[20px] min-h-[20px] flex-1"
      >
        {value.length === 0 && <span className="text-muted text-sm">&nbsp;</span>}
        {value.map((v) => {
          const opt = options.find((o) => o.value === v);
          const c = TAG_COLORS[opt?.color ?? "gray"] ?? TAG_COLORS.gray;
          return (
            <span
              key={v}
              className={`inline-block px-2 py-0.5 rounded text-xs ${c.bg} ${c.text}`}
            >
              {v}
            </span>
          );
        })}
      </div>
      {open && (
        <SelectTagPicker
          options={options}
          value={value}
          multi={multi}
          onChange={(next) => {
            onChange(multi ? next : next[0] ?? "");
          }}
          onOptionsChange={onOptionsChange}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  );
}

// ── Formula Cell ───────────────────────────────────────────

function FormulaCell({
  formula,
  cells,
}: {
  formula: string;
  cells: Record<string, unknown>;
}) {
  const result = evaluateFormula(formula, cells);
  const isError = result === "#ERR";
  return (
    <span className={`block text-sm text-right min-h-[28px] leading-[28px] ${isError ? "text-red-500" : "text-muted"}`}>
      {isError ? "#ERR" : result !== 0 ? result : <span className="text-muted">0</span>}
    </span>
  );
}

