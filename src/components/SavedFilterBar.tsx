import { useState, useRef, useEffect } from "react";
import { Bookmark, Plus, X, Pencil, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import {
  useSavedFilters,
  useCreateSavedFilter,
  useRenameSavedFilter,
  useDeleteSavedFilter,
} from "../db/hooks/useSavedFilters";
import { useT } from "../i18n/useT";
import type { SavedFilter, SavedFilterData, FilterCondition, FilterableField, FilterOperator, ConditionLogic } from "../types/saved-filter";

const STRING_OPERATORS: FilterOperator[] = ["eq", "neq", "contains"];
const NUMBER_OPERATORS: FilterOperator[] = ["eq", "neq", "gt", "lt", "gte", "lte"];

interface Props {
  page: string;
  currentFilters: SavedFilterData;
  onApply: (filters: SavedFilterData) => void;
  activeFilterId: number | null;
  onActiveChange: (id: number | null) => void;
  /** Filterable fields available for this page */
  fields?: FilterableField[];
}

function defaultOperator(type: FilterableField["type"]): FilterOperator {
  return type === "number" ? "eq" : "eq";
}

function operatorsForType(type: FilterableField["type"]): FilterOperator[] {
  switch (type) {
    case "number":
      return NUMBER_OPERATORS;
    case "select":
      return ["eq", "neq"];
    default:
      return STRING_OPERATORS;
  }
}

function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
  t,
}: {
  condition: FilterCondition;
  fields: FilterableField[];
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
  t: Record<string, string>;
}) {
  const fieldDef = fields.find((f) => f.key === condition.field) ?? fields[0];
  const ops = operatorsForType(fieldDef?.type ?? "string");

  const opLabels: Record<FilterOperator, string> = {
    eq: t.op_eq,
    neq: t.op_neq,
    contains: t.op_contains,
    gt: t.op_gt,
    lt: t.op_lt,
    gte: t.op_gte,
    lte: t.op_lte,
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={condition.field}
        onChange={(e) => {
          const newField = fields.find((f) => f.key === e.target.value);
          const newOps = operatorsForType(newField?.type ?? "string");
          const newOp = newOps.includes(condition.operator) ? condition.operator : newOps[0];
          onChange({ field: e.target.value, operator: newOp, value: "" });
        }}
        className="text-xs px-1.5 py-1 border border-[var(--color-border-divider)] rounded-lg bg-transparent min-w-[80px]"
      >
        {fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as FilterOperator })}
        className="text-xs px-1.5 py-1 border border-[var(--color-border-divider)] rounded-lg bg-transparent"
      >
        {ops.map((op) => (
          <option key={op} value={op}>{opLabels[op]}</option>
        ))}
      </select>
      {fieldDef?.type === "select" && fieldDef.options ? (
        <select
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          className="text-xs px-1.5 py-1 border border-[var(--color-border-divider)] rounded-lg bg-transparent min-w-[80px]"
        >
          <option value="">--</option>
          {fieldDef.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder={t.value}
          className="text-xs px-1.5 py-1 border border-[var(--color-border-divider)] rounded-lg bg-transparent w-24"
        />
      )}
      <button onClick={onRemove} className="text-muted hover:text-red-500">
        <X size={12} />
      </button>
    </div>
  );
}

export function SavedFilterBar({ page, currentFilters, onApply, activeFilterId, onActiveChange, fields }: Props) {
  const t = useT() as Record<string, string>;
  const { data: filters } = useSavedFilters(page);
  const createFilter = useCreateSavedFilter(page);
  const renameFilter = useRenameSavedFilter(page);
  const deleteFilter = useDeleteSavedFilter(page);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filter: SavedFilter } | null>(null);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [conditionLogic, setConditionLogic] = useState<ConditionLogic>("and");
  const [showConditions, setShowConditions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  useEffect(() => {
    if (editingId != null) editInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  // Sync internal conditions state when parent filters change (e.g. saved filter loaded)
  useEffect(() => {
    setConditions(currentFilters.conditions ?? []);
    setConditionLogic(currentFilters.conditionLogic ?? "and");
  }, [currentFilters.conditions, currentFilters.conditionLogic]);

  const handleStartNaming = () => {
    setNaming(true);
    // Pre-populate conditions from current active filter conditions if any
    setConditions(currentFilters.conditions ?? []);
    setConditionLogic(currentFilters.conditionLogic ?? "and");
  };

  const handleSave = () => {
    const name = nameInput.trim();
    if (!name) return;
    const filtersToSave: SavedFilterData = {
      ...currentFilters,
      conditions: conditions.filter((c) => c.value.trim() !== ""),
      conditionLogic,
    };
    createFilter.mutate(
      { name, filters: filtersToSave },
      {
        onSuccess: (id) => {
          toast.success(t.filter_saved);
          onActiveChange(id);
          onApply(filtersToSave);
          setNaming(false);
          setNameInput("");
          setConditions([]);
          setShowConditions(false);
        },
      }
    );
  };

  const handleRename = () => {
    if (editingId == null) return;
    const name = editName.trim();
    if (!name) return;
    renameFilter.mutate({ id: editingId, name }, {
      onSuccess: () => {
        setEditingId(null);
        setEditName("");
      },
    });
  };

  const handleDelete = (id: number) => {
    deleteFilter.mutate(id, {
      onSuccess: () => {
        if (activeFilterId === id) onActiveChange(null);
      },
    });
  };

  const handleClearAll = () => {
    onActiveChange(null);
    // Reset to no conditions
    onApply({ ...currentFilters, conditions: [] });
  };

  const addCondition = () => {
    if (!fields || fields.length === 0) return;
    const firstField = fields[0];
    setConditions((prev) => [
      ...prev,
      { field: firstField.key, operator: defaultOperator(firstField.type), value: "" },
    ]);
    setShowConditions(true);
  };

  const updateCondition = (index: number, c: FilterCondition) => {
    setConditions((prev) => prev.map((old, i) => (i === index ? c : old)));
  };

  const removeCondition = (index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const conditionsUI = fields && fields.length > 0 && showConditions && (
    <div className="flex flex-col gap-1.5 mt-1.5 mb-1">
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <select
              value={conditionLogic}
              onChange={(e) => setConditionLogic(e.target.value as ConditionLogic)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-muted w-12"
            >
              <option value="and">AND</option>
              <option value="or">OR</option>
            </select>
          )}
          {i === 0 && <div className="w-12" />}
          <div className="flex-1">
            <ConditionRow
              condition={c}
              fields={fields}
              onChange={(updated) => updateCondition(i, updated)}
              onRemove={() => removeCondition(i)}
              t={t}
            />
          </div>
        </div>
      ))}
      <button
        onClick={addCondition}
        className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors self-start ml-[52px]"
      >
        <Plus size={10} />
        {t.add_condition}
      </button>
    </div>
  );

  if (!filters || filters.length === 0) {
    return (
      <div className="flex flex-col gap-1 mb-3">
        <div className="flex items-center gap-2">
          {naming ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                    if (e.key === "Escape") { setNaming(false); setNameInput(""); setConditions([]); setShowConditions(false); }
                  }}
                  placeholder={t.filter_name}
                  className="text-xs px-2 py-1 border border-[var(--color-border-divider)] rounded-lg w-36 bg-transparent"
                />
                {fields && fields.length > 0 && (
                  <button
                    onClick={() => { setShowConditions(!showConditions); if (!showConditions && conditions.length === 0) addCondition(); }}
                    className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded-md transition-colors ${
                      showConditions ? "text-accent bg-accent-light" : "text-muted hover:text-accent"
                    }`}
                    title={t.add_condition}
                  >
                    <Filter size={12} />
                  </button>
                )}
                <button onClick={handleSave} className="text-xs text-accent hover:text-accent-hover px-1">{t.save}</button>
                <button onClick={() => { setNaming(false); setNameInput(""); setConditions([]); setShowConditions(false); }} className="text-muted hover:text-[var(--color-text-secondary)]"><X size={12} /></button>
              </div>
              {conditionsUI}
            </div>
          ) : (
            <button
              onClick={handleStartNaming}
              className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
            >
              <Bookmark size={12} />
              {t.save_filter}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 mb-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={handleClearAll}
          className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
            activeFilterId == null
              ? "bg-accent text-white"
              : "text-muted hover:bg-[var(--color-hover-row)]"
          }`}
        >
          {t.all}
        </button>

        {filters.map((f) => {
          const condCount = f.filters.conditions?.length ?? 0;
          return (
            <button
              key={f.id}
              onClick={() => {
                onActiveChange(f.id);
                onApply(f.filters);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, filter: f });
              }}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                activeFilterId === f.id
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-[var(--color-hover-row)]"
              }`}
            >
              {editingId === f.id ? (
                <input
                  ref={editInputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                  }}
                  onBlur={handleRename}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs bg-transparent border-b border-accent w-20 outline-none"
                />
              ) : (
                <>
                  {f.name}
                  {condCount > 0 && (
                    <span className={`text-[10px] rounded-full px-1 py-0 ${
                      activeFilterId === f.id ? "bg-white/25" : "bg-[var(--color-input-bg)] text-[var(--color-muted)]"
                    }`}>
                      {condCount}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}

        {naming ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") { setNaming(false); setNameInput(""); setConditions([]); setShowConditions(false); }
                }}
                placeholder={t.filter_name}
                className="text-xs px-2 py-1 border border-[var(--color-border-divider)] rounded-lg w-28 bg-transparent"
              />
              {fields && fields.length > 0 && (
                <button
                  onClick={() => { setShowConditions(!showConditions); if (!showConditions && conditions.length === 0) addCondition(); }}
                  className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded-md transition-colors ${
                    showConditions ? "text-accent bg-accent-light" : "text-muted hover:text-accent"
                  }`}
                  title={t.add_condition}
                >
                  <Filter size={12} />
                </button>
              )}
              <button onClick={handleSave} className="text-xs text-accent hover:text-accent-hover px-1">{t.save}</button>
              <button onClick={() => { setNaming(false); setNameInput(""); setConditions([]); setShowConditions(false); }} className="text-muted hover:text-[var(--color-text-secondary)]"><X size={12} /></button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartNaming}
            className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors px-1"
            title={t.save_filter}
          >
            <Plus size={12} />
          </button>
        )}

        {ctxMenu && createPortal(
          <div
            className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg py-1 min-w-[140px] animate-in"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--color-hover-row)]"
              onClick={() => {
                setEditingId(ctxMenu.filter.id);
                setEditName(ctxMenu.filter.name);
                setCtxMenu(null);
              }}
            >
              <Pencil size={12} /> {t.rename}
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              onClick={() => {
                handleDelete(ctxMenu.filter.id);
                setCtxMenu(null);
              }}
            >
              <Trash2 size={12} /> {t.delete}
            </button>
          </div>,
          document.body
        )}
      </div>
      {conditionsUI}
    </div>
  );
}
