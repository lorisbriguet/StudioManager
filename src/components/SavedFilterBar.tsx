import { useState, useRef, useEffect } from "react";
import { Bookmark, Plus, X, Pencil, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, FilterChip } from "./ui";
import { ContextMenu } from "./ContextMenu";
import {
  useSavedFilters,
  useCreateSavedFilter,
  useRenameSavedFilter,
  useUpdateSavedFilter,
  useDeleteSavedFilter,
} from "../db/hooks/useSavedFilters";
import { useT } from "../i18n/useT";
import type { SavedFilter, SavedFilterData, FilterCondition, FilterableField, FilterOperator, ConditionLogic } from "../types/saved-filter";
import { IconButton } from "./ui/IconButton";

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
      <Select
        value={condition.field}
        onChange={(e) => {
          const newField = fields.find((f) => f.key === e.target.value);
          const newOps = operatorsForType(newField?.type ?? "string");
          const newOp = newOps.includes(condition.operator) ? condition.operator : newOps[0];
          onChange({ field: e.target.value, operator: newOp, value: "" });
        }}
        fullWidth={false}
        className="min-w-[80px]"
      >
        {fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </Select>
      <Select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as FilterOperator })}
        fullWidth={false}
      >
        {ops.map((op) => (
          <option key={op} value={op}>{opLabels[op]}</option>
        ))}
      </Select>
      {fieldDef?.type === "select" && fieldDef.options ? (
        <Select
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          fullWidth={false}
        className="min-w-[80px]"
        >
          <option value="">--</option>
          {fieldDef.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      ) : (
        <input
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder={t.value}
          className="text-xs px-1.5 py-1 border border-[var(--color-border-divider)] rounded-lg bg-transparent w-24"
        />
      )}
      <IconButton icon={X} label={t.remove} size="xs" tone="danger" onClick={onRemove} />
    </div>
  );
}

export function SavedFilterBar({ page, currentFilters, onApply, activeFilterId, onActiveChange, fields }: Props) {
  const t = useT() as Record<string, string>;
  const { data: filters } = useSavedFilters(page);
  const createFilter = useCreateSavedFilter(page);
  const renameFilter = useRenameSavedFilter(page);
  const updateFilter = useUpdateSavedFilter(page);
  const deleteFilter = useDeleteSavedFilter(page);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filter: SavedFilter } | null>(null);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [conditionLogic, setConditionLogic] = useState<ConditionLogic>("and");
  const [showConditions, setShowConditions] = useState(false);
  const [editingFilterId, setEditingFilterId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  useEffect(() => {
    if (editingId != null) editInputRef.current?.focus();
  }, [editingId]);

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

  const handleStartEditConditions = (filter: SavedFilter) => {
    setEditingFilterId(filter.id);
    setConditions(filter.filters.conditions ?? []);
    setConditionLogic(filter.filters.conditionLogic ?? "and");
    setShowConditions(true);
    onActiveChange(filter.id);
    onApply(filter.filters);
  };

  const handleUpdateFilter = () => {
    if (editingFilterId == null) return;
    const f = filters?.find((f) => f.id === editingFilterId);
    if (!f) return;
    const updatedFilters: SavedFilterData = {
      ...f.filters,
      conditions: conditions.filter((c) => c.value.trim() !== ""),
      conditionLogic,
    };
    updateFilter.mutate(
      { id: editingFilterId, filters: updatedFilters },
      {
        onSuccess: () => {
          toast.success(t.filter_updated);
          onApply(updatedFilters);
          setEditingFilterId(null);
          setShowConditions(false);
        },
      }
    );
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
            <Select
              value={conditionLogic}
              onChange={(e) => setConditionLogic(e.target.value as ConditionLogic)}
              fullWidth={false}
              className="min-w-fit w-14"
            >
              <option value="and">AND</option>
              <option value="or">OR</option>
            </Select>
          )}
          {i === 0 && <div className="w-14" />}
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
      <div className="flex items-center gap-2 ml-14.5">
        <Button
          variant="link"
          size="sm"
          icon={<Plus size={12} />}
          onClick={addCondition}
          className="text-muted hover:text-accent"
        >
          {t.add_condition}
        </Button>
        {editingFilterId != null && (
          <>
            <button
              onClick={handleUpdateFilter}
              className="text-xs text-accent hover:text-accent-hover px-1"
            >
              {t.save}
            </button>
            <IconButton icon={X} label={t.cancel} size="xs" onClick={() => { setEditingFilterId(null); setShowConditions(false); }} />
          </>
        )}
      </div>
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
                  <IconButton icon={Filter} label={t.add_condition} iconSize={12} tone="accent" active={showConditions} onClick={() => { setShowConditions(!showConditions); if (!showConditions && conditions.length === 0) addCondition(); }} />
                )}
                <button onClick={handleSave} className="text-xs text-accent hover:text-accent-hover px-1">{t.save}</button>
                <IconButton icon={X} label={t.cancel} size="xs" onClick={() => { setNaming(false); setNameInput(""); setConditions([]); setShowConditions(false); }} />
              </div>
              {conditionsUI}
            </div>
          ) : (
            <Button
              variant="link"
              size="sm"
              icon={<Bookmark size={12} />}
              onClick={handleStartNaming}
              className="text-muted hover:text-accent"
            >
              {t.save_filter}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 mb-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterChip active={activeFilterId == null} onClick={handleClearAll}>
          {t.all}
        </FilterChip>

        {filters.map((f) => {
          const condCount = f.filters.conditions?.length ?? 0;
          return (
            <FilterChip
              key={f.id}
              active={activeFilterId === f.id}
              count={editingId !== f.id && condCount > 0 ? condCount : undefined}
              onClick={() => {
                if (activeFilterId === f.id && fields && fields.length > 0) {
                  // Already active — toggle condition editor
                  if (editingFilterId === f.id) {
                    setEditingFilterId(null);
                    setShowConditions(false);
                  } else {
                    handleStartEditConditions(f);
                  }
                } else {
                  onActiveChange(f.id);
                  onApply(f.filters);
                  setEditingFilterId(null);
                  setShowConditions(false);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, filter: f });
              }}
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
                f.name
              )}
            </FilterChip>
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
                <IconButton icon={Filter} label={t.add_condition} iconSize={12} tone="accent" active={showConditions} onClick={() => { setShowConditions(!showConditions); if (!showConditions && conditions.length === 0) addCondition(); }} />
              )}
              <button onClick={handleSave} className="text-xs text-accent hover:text-accent-hover px-1">{t.save}</button>
              <IconButton icon={X} label={t.cancel} size="xs" onClick={() => { setNaming(false); setNameInput(""); setConditions([]); setShowConditions(false); }} />
            </div>
          </div>
        ) : (
          <IconButton icon={Plus} label={t.save_filter} size="xs" tone="accent" onClick={handleStartNaming} />
        )}

        {ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            items={[
              {
                label: t.rename,
                icon: <Pencil size={12} />,
                onClick: () => {
                  setEditingId(ctxMenu.filter.id);
                  setEditName(ctxMenu.filter.name);
                },
              },
              ...(fields && fields.length > 0
                ? [
                    {
                      label: t.edit_conditions,
                      icon: <Filter size={12} />,
                      onClick: () => handleStartEditConditions(ctxMenu.filter),
                    },
                  ]
                : []),
              {
                label: t.delete,
                icon: <Trash2 size={12} />,
                danger: true,
                onClick: () => handleDelete(ctxMenu.filter.id),
              },
            ]}
          />
        )}
      </div>
      {conditionsUI}
    </div>
  );
}
