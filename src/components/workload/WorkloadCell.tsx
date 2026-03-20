import { useState, useRef, useEffect, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { Link2 } from "lucide-react";
import { TAG_COLORS, type WorkloadColumn, type SelectOption } from "../../types/workload";
import { SelectTagPicker } from "./SelectTagPicker";
import { evaluateFormula } from "../../lib/formulaEval";
import type { Task } from "../../types/task";

interface Props {
  column: WorkloadColumn;
  value: unknown;
  allCells: Record<string, unknown>;
  onChange: (value: unknown) => void;
  tasks?: Task[];
  linkedTaskId?: number | null;
  onLinkTask?: (taskId: number | null) => void;
  onOptionsChange?: (options: SelectOption[]) => void;
}

export const WorkloadCell = memo(function WorkloadCell({
  column,
  value,
  allCells,
  onChange,
  tasks,
  linkedTaskId,
  onLinkTask,
  onOptionsChange,
}: Props) {
  switch (column.type) {
    case "text":
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
    case "link":
      return (
        <LinkCell
          value={(value as string) ?? ""}
          onChange={onChange}
          tasks={tasks ?? []}
          linkedTaskId={linkedTaskId ?? null}
          onLinkTask={onLinkTask}
        />
      );
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
        className="w-full text-sm border border-gray-200 rounded px-2 py-0.5 outline-none"
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
        className="w-full text-sm border border-gray-200 rounded px-2 py-0.5 outline-none text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
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

// ── Link Cell ─────────────────────────────────────────────

function LinkCell({
  value,
  onChange,
  tasks,
  linkedTaskId,
  onLinkTask,
}: {
  value: string;
  onChange: (v: string) => void;
  tasks: Task[];
  linkedTaskId: number | null;
  onLinkTask?: (taskId: number | null) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkedTask = linkedTaskId ? tasks.find((t) => t.id === linkedTaskId) : null;

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

  return (
    <div className="flex items-start gap-1 min-h-[28px] group/cell">
      {linkedTask ? (
        <span className="flex-1 text-sm text-accent break-words whitespace-pre-wrap py-1 leading-[20px]">
          {linkedTask.title}
        </span>
      ) : editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 text-sm border border-gray-200 rounded px-2 py-0.5 outline-none"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className="flex-1 text-sm cursor-text break-words whitespace-pre-wrap py-1 leading-[20px]"
        >
          {value || <span className="text-muted">&nbsp;</span>}
        </span>
      )}
      {onLinkTask && (
        <TaskPickerTrigger
          tasks={tasks}
          linkedTaskId={linkedTaskId}
          showTaskPicker={showPicker}
          setShowTaskPicker={setShowPicker}
          onLinkTask={onLinkTask}
        />
      )}
    </div>
  );
}

// ── Task Picker Trigger ───────────────────────────────────

function TaskPickerTrigger({
  tasks,
  linkedTaskId,
  showTaskPicker,
  setShowTaskPicker,
  onLinkTask,
}: {
  tasks: Task[];
  linkedTaskId?: number | null;
  showTaskPicker: boolean;
  setShowTaskPicker: (v: boolean) => void;
  onLinkTask: (id: number | null) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setShowTaskPicker(!showTaskPicker)}
        className={`shrink-0 p-0.5 rounded hover:bg-gray-100 ${
          linkedTaskId
            ? "text-accent"
            : "text-muted opacity-0 group-hover/cell:opacity-100"
        }`}
        title="Link to task"
      >
        <Link2 size={14} />
      </button>
      {showTaskPicker && (
        <TaskPicker
          tasks={tasks}
          currentId={linkedTaskId ?? null}
          onSelect={(id) => {
            onLinkTask(id);
            setShowTaskPicker(false);
          }}
          onClose={() => setShowTaskPicker(false)}
          anchorRef={btnRef}
        />
      )}
    </div>
  );
}

// ── Task Picker ────────────────────────────────────────────

function TaskPicker({
  tasks,
  currentId,
  onSelect,
  onClose,
  anchorRef,
}: {
  tasks: Task[];
  currentId: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right - 192 }); // 192 = w-48
    }
  }, [anchorRef]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const dropdown = (
    <div
      ref={ref}
      className="fixed z-50 w-48 bg-gray-100 border border-gray-200 rounded-lg shadow-lg overflow-hidden"
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      {currentId && (
        <button
          onClick={() => onSelect(null)}
          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-200"
        >
          Unlink task
        </button>
      )}
      <div className="max-h-48 overflow-y-auto">
        {tasks.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-200 truncate ${
              t.id === currentId ? "bg-accent-light text-accent" : ""
            }`}
          >
            {t.title}
          </button>
        ))}
        {tasks.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted">No tasks</div>
        )}
      </div>
    </div>
  );

  if (anchorRef) {
    return createPortal(dropdown, document.body);
  }
  return dropdown;
}
