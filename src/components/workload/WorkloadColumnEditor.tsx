import { useState, useEffect } from "react";
import { X, Plus, Trash2, Calendar, Link, Unlink } from "lucide-react";
import { Button } from "../ui";
import { toast } from "sonner";
import type { WorkloadColumn, WorkloadColumnType, SelectOption } from "../../types/workload";
import { TAG_COLORS, TAG_COLOR_NAMES } from "../../types/workload";
import { COLUMN_ICONS, COLUMN_ICON_NAMES } from "./columnIcons";
import { evaluateFormula } from "../../lib/formulaEval";
import { useT } from "../../i18n/useT";
import { useCustomLists, useCustomListItems, useCreateCustomList, useSetCustomListItems } from "../../db/hooks/useCustomLists";

interface Props {
  column: WorkloadColumn | null; // null = creating new
  existingKeys?: string[];
  onSave: (column: WorkloadColumn) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const COLUMN_TYPES: { value: WorkloadColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi Select" },
  { value: "formula", label: "Formula" },
  { value: "link", label: "Link to Task" },
];

export function WorkloadColumnEditor({ column, existingKeys = [], onSave, onDelete, onClose }: Props) {
  const t = useT();
  const isNew = column === null;

  const [name, setName] = useState(column?.name ?? "");
  const [type, setType] = useState<WorkloadColumnType>(column?.type ?? "text");
  const [icon, setIcon] = useState(column?.icon ?? "");
  const [iconOnly, setIconOnly] = useState(column?.iconOnly ?? false);
  const [options, setOptions] = useState<SelectOption[]>(column?.options ?? []);
  const [formula, setFormula] = useState(column?.formula ?? "");
  const [calendarColor, setCalendarColor] = useState(column?.calendarColor ?? false);
  const [newOptValue, setNewOptValue] = useState("");
  const [newOptColor, setNewOptColor] = useState("gray");
  const [formulaError, setFormulaError] = useState("");
  const [linkedListId, setLinkedListId] = useState<number | undefined>(column?.linked_list_id);
  const [showImportListDropdown, setShowImportListDropdown] = useState(false);
  const [saveAsListName, setSaveAsListName] = useState("");
  const [showSaveAsListInput, setShowSaveAsListInput] = useState(false);
  const [importListId, setImportListId] = useState<number | null>(null);

  const { data: customLists } = useCustomLists();
  const { data: importListItems } = useCustomListItems(importListId);
  const createCustomList = useCreateCustomList();
  const setCustomListItems = useSetCustomListItems();

  // When import list items arrive, apply them
  useEffect(() => {
    if (!importListItems || importListId === null) return;
    setOptions(importListItems.map((i) => ({ value: i.value, color: i.color ?? "gray" })));
    setLinkedListId(importListId);
    setImportListId(null);
    setShowImportListDropdown(false);
  }, [importListItems, importListId]);

  const validateFormula = (f: string): string => {
    if (!f.trim()) return "";
    try {
      const result = evaluateFormula(f, { test: 1 });
      if (result === "#ERR") return t.formula_invalid;
      return "";
    } catch {
      return t.formula_invalid;
    }
  };

  const handleFormulaChange = (value: string) => {
    setFormula(value);
    setFormulaError(validateFormula(value));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (type === "formula" && formula.trim() && formulaError) return;
    let key = column?.key ?? name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!column) {
      let base = key;
      let i = 2;
      while (existingKeys.includes(key)) {
        key = `${base}_${i++}`;
      }
    }
    const col: WorkloadColumn = {
      key,
      name: name.trim(),
      type,
      width: column?.width ?? 120,
    };
    if (icon) {
      col.icon = icon;
      col.iconOnly = iconOnly;
    }
    if (type === "select" || type === "multi_select") {
      col.options = options;
      if (linkedListId !== undefined) {
        col.linked_list_id = linkedListId;
      }
    }
    if (type === "formula") {
      col.formula = formula;
    }
    if ((type === "select" || type === "multi_select") && calendarColor) {
      col.calendarColor = true;
    }
    onSave(col);
    onClose();
  };

  const addOption = () => {
    const val = newOptValue.trim();
    if (!val || options.some((o) => o.value === val)) return;
    setOptions([...options, { value: val, color: newOptColor }]);
    setNewOptValue("");
  };

  const handleSaveAsList = async () => {
    const name = saveAsListName.trim();
    if (!name || options.length === 0) return;
    const id = await createCustomList.mutateAsync(name);
    await setCustomListItems.mutateAsync({ listId: id, items: options.map((o) => ({ value: o.value, color: o.color })) });
    setShowSaveAsListInput(false);
    setSaveAsListName("");
    toast.success(t.list_created ?? "List created");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-md border border-[var(--color-border-divider)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-divider)]">
          <h3 className="text-sm font-medium">
            {isNew ? t.add_column : t.edit_column}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-[var(--color-text-secondary)]">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Name */}
          <div>
            <label className="text-xs text-muted block mb-1">{t.name}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-[var(--color-border-divider)] rounded-md px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-muted block mb-1">{t.type}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as WorkloadColumnType)}
              className="w-full border border-[var(--color-border-divider)] rounded-md px-3 py-2 text-sm"
            >
              {COLUMN_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>
                  {ct.label}
                </option>
              ))}
            </select>
          </div>

          {/* Icon */}
          <div>
            <label className="text-xs text-muted block mb-1">{t.icon}</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 border border-[var(--color-border-divider)] rounded-md overflow-hidden">
                <div className="flex flex-wrap gap-0.5 p-1.5 max-h-24 overflow-y-auto">
                  <button
                    onClick={() => { setIcon(""); setIconOnly(false); }}
                    className={`p-1 rounded ${!icon ? "bg-accent text-white" : "hover:bg-[var(--color-hover-row)] text-muted"}`}
                    title="None"
                  >
                    <X size={14} />
                  </button>
                  {COLUMN_ICON_NAMES.map((name) => {
                    const Icon = COLUMN_ICONS[name];
                    return (
                      <button
                        key={name}
                        onClick={() => setIcon(name)}
                        className={`p-1 rounded ${icon === name ? "bg-accent text-white" : "hover:bg-[var(--color-hover-row)] text-muted"}`}
                        title={name}
                      >
                        <Icon size={14} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {icon && (
              <label className="flex items-center gap-2 mt-2 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={iconOnly}
                  onChange={(e) => setIconOnly(e.target.checked)}
                  className="rounded"
                />
                {t.icon_only}
              </label>
            )}
          </div>

          {/* Calendar color toggle (select/multi_select only) */}
          {(type === "select" || type === "multi_select") && (
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={calendarColor}
                onChange={(e) => setCalendarColor(e.target.checked)}
                className="rounded"
              />
              <Calendar size={14} className="shrink-0" />
              {t.calendar_color_column}
            </label>
          )}

          {/* Formula */}
          {type === "formula" && (
            <div>
              <label className="text-xs text-muted block mb-1">{t.formula}</label>
              <input
                value={formula}
                onChange={(e) => handleFormulaChange(e.target.value)}
                placeholder="e.g. og_scope ? hours : 0"
                className={`w-full border rounded-md px-3 py-2 text-sm font-mono ${formulaError ? "border-[var(--color-danger-text)]" : "border-[var(--color-border-divider)]"}`}
              />
              {formulaError ? (
                <p className="text-[10px] text-[var(--color-danger-text)] mt-1">{formulaError}</p>
              ) : (
                <p className="text-[10px] text-muted mt-1">{t.formula_help}</p>
              )}
            </div>
          )}

          {/* Select options */}
          {(type === "select" || type === "multi_select") && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted">{t.options}</label>
                {linkedListId ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-accent flex items-center gap-0.5">
                      <Link size={11} />
                      {(customLists ?? []).find((l) => l.id === linkedListId)?.name ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLinkedListId(undefined)}
                      className="text-xs text-muted hover:text-[var(--color-danger-text)] flex items-center gap-0.5"
                    >
                      <Unlink size={11} /> {t.unlink_list}
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowImportListDropdown((v) => !v)}
                      className="text-xs text-accent hover:underline flex items-center gap-0.5"
                    >
                      <Link size={11} /> {t.import_from_list}
                    </button>
                    {showImportListDropdown && (
                      <div className="absolute right-0 top-full mt-1 z-[10000] bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-lg shadow-lg py-1 min-w-[150px]">
                        {(customLists ?? []).length === 0 ? (
                          <p className="text-xs text-muted px-3 py-1.5">{t.no_lists}</p>
                        ) : (
                          (customLists ?? []).map((list) => (
                            <button
                              key={list.id}
                              type="button"
                              onClick={() => setImportListId(list.id)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-row)]"
                            >
                              {list.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5 mb-2">
                {options.map((opt, i) => {
                  const c = TAG_COLORS[opt.color] ?? TAG_COLORS.gray;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${c.bg} ${c.text}`}
                      >
                        {opt.value}
                      </span>
                      <select
                        value={opt.color}
                        onChange={(e) => {
                          if (linkedListId) return;
                          const next = [...options];
                          next[i] = { ...next[i], color: e.target.value };
                          setOptions(next);
                        }}
                        disabled={!!linkedListId}
                        className="text-xs border border-[var(--color-border-divider)] rounded px-1 py-0.5 disabled:opacity-60"
                      >
                        {TAG_COLOR_NAMES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      {!linkedListId && (
                        <button
                          onClick={() => setOptions(options.filter((_, j) => j !== i))}
                          className="text-muted hover:text-[var(--color-danger-text)] ml-auto"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {!linkedListId && (
                <>
                  <div className="flex gap-2 mb-2">
                    <input
                      value={newOptValue}
                      onChange={(e) => setNewOptValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addOption()}
                      placeholder={t.new_option}
                      className="flex-1 border border-[var(--color-border-divider)] rounded px-2 py-1.5 text-sm"
                    />
                    <select
                      value={newOptColor}
                      onChange={(e) => setNewOptColor(e.target.value)}
                      className="text-sm border border-[var(--color-border-divider)] rounded px-2 py-1.5"
                    >
                      {TAG_COLOR_NAMES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={addOption}
                      className="p-1.5 text-muted hover:text-accent"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="border-t border-[var(--color-border-divider)] pt-2">
                    {showSaveAsListInput ? (
                      <div className="flex gap-2">
                        <input
                          value={saveAsListName}
                          onChange={(e) => setSaveAsListName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveAsList(); if (e.key === "Escape") setShowSaveAsListInput(false); }}
                          placeholder={t.list_name}
                          className="flex-1 border border-[var(--color-border-divider)] rounded px-2 py-1.5 text-sm"
                          autoFocus
                        />
                        <button type="button" onClick={handleSaveAsList} className="px-3 text-sm text-accent hover:underline">{t.save}</button>
                        <button type="button" onClick={() => setShowSaveAsListInput(false)} className="px-2 text-muted hover:text-[var(--color-text-secondary)]"><X size={14} /></button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowSaveAsListInput(true)}
                        className="text-xs text-muted hover:text-accent flex items-center gap-1"
                      >
                        <Link size={12} /> {t.save_as_list}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border-divider)]">
          <div>
            {!isNew && onDelete && (
              <Button
                variant="ghost"
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                className="text-[var(--color-danger-text)] hover:text-red-700"
              >
                {t.delete_column}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={onClose}
            >
              {t.cancel}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || (type === "formula" && !!formulaError && !!formula.trim())}
            >
              {t.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
