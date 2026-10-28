import { useState, useRef, useEffect, type RefObject } from "react";
import { Bookmark, Plus, X, Pencil, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, FilterChip, Input } from "../ui";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";
import { ContextMenu } from "../ui/ContextMenu";
import {
  useSavedFilters,
  useCreateSavedFilter,
  useRenameSavedFilter,
  useUpdateSavedFilter,
  useDeleteSavedFilter,
} from "../../db/hooks/useSavedFilters";
import { useT } from "../../i18n/useT";
import type { SavedFilter, SavedFilterData, FilterCondition, FilterableField, FilterOperator, ConditionLogic } from "../../types/saved-filter";
import { IconButton } from "../ui/IconButton";

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

/** A new condition starts on its type's first operator, as when its field changes in ConditionRow. */
function defaultOperator(type: FilterableField["type"]): FilterOperator {
  return operatorsForType(type)[0];
}

const LOGIC_OPTIONS: SegmentedOption<ConditionLogic>[] = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
];
/** Width of the AND/OR column, so condition rows line up (the first row has no control). */
const LOGIC_COLUMN = "w-26";

/** The "name a new filter" row: name field, conditions toggle, Save, cancel. */
function NewFilterRow({
  inputRef,
  value,
  onChange,
  onSave,
  onCancel,
  conditions,
  inputClassName,
  t,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** The conditions toggle, when the page has filterable fields. */
  conditions?: { open: boolean; onToggle: () => void };
  inputClassName: string;
  t: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        fullWidth={false}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={t.filter_name}
        className={inputClassName}
      />
      {conditions && (
        <IconButton icon={Filter} label={t.add_condition} tone="accent" active={conditions.open} onClick={conditions.onToggle} />
      )}
      <Button variant="link" onClick={onSave}>
        {t.save}
      </Button>
      <IconButton icon={X} label={t.cancel} size="xs" onClick={onCancel} />
    </div>
  );
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
        <Input fullWidth={false}
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder={t.value}
          className="w-24"
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
          <div className={`${LOGIC_COLUMN} shrink-0`}>
            {i > 0 && (
              <SegmentedControl<ConditionLogic>
                aria-label={t.condition_logic}
                value={conditionLogic}
                onChange={setConditionLogic}
                options={LOGIC_OPTIONS}
                fullWidth
              />
            )}
          </div>
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
      <div className="flex items-center gap-2 ml-26.5">
        <Button
          variant="link"
          icon={<Plus size={12} />}
          onClick={addCondition}
          className="text-muted hover:text-accent"
        >
          {t.add_condition}
        </Button>
        {editingFilterId != null && (
          <>
            <Button variant="link" onClick={handleUpdateFilter}>
              {t.save}
            </Button>
            <IconButton icon={X} label={t.cancel} size="xs" onClick={() => { setEditingFilterId(null); setShowConditions(false); }} />
          </>
        )}
      </div>
    </div>
  );

  const cancelNaming = () => {
    setNaming(false);
    setNameInput("");
    setConditions([]);
    setShowConditions(false);
  };

  const newFilterRowProps = {
    inputRef,
    value: nameInput,
    onChange: setNameInput,
    onSave: handleSave,
    onCancel: cancelNaming,
    conditions:
      fields && fields.length > 0
        ? {
            open: showConditions,
            onToggle: () => {
              setShowConditions(!showConditions);
              if (!showConditions && conditions.length === 0) addCondition();
            },
          }
        : undefined,
    t,
  };

  if (!filters || filters.length === 0) {
    return (
      <div className="flex flex-col gap-1 mb-3">
        <div className="flex items-center gap-2">
          {naming ? (
            <div className="flex flex-col gap-1.5">
              <NewFilterRow {...newFilterRowProps} inputClassName="w-36" />
              {conditionsUI}
            </div>
          ) : (
            <Button
              variant="link"
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
          // Renaming: the field takes the chip's place (an input can't sit inside the chip's <button>).
          if (editingId === f.id) {
            return (
              <Input
                key={f.id}
                fullWidth={false}
                ref={editInputRef}
                aria-label={t.rename}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                }}
                onBlur={handleRename}
                className="w-28"
              />
            );
          }
          const condCount = f.filters.conditions?.length ?? 0;
          return (
            <FilterChip
              key={f.id}
              active={activeFilterId === f.id}
              count={condCount > 0 ? condCount : undefined}
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
              {f.name}
            </FilterChip>
          );
        })}

        {naming ? (
          <NewFilterRow {...newFilterRowProps} inputClassName="w-28" />
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
