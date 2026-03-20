import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { WorkloadColumn, WorkloadColumnType, SelectOption } from "../../types/workload";
import { TAG_COLORS, TAG_COLOR_NAMES } from "../../types/workload";
import { COLUMN_ICONS, COLUMN_ICON_NAMES } from "./columnIcons";
import { evaluateFormula } from "../../lib/formulaEval";
import { useT } from "../../i18n/useT";

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
  const [newOptValue, setNewOptValue] = useState("");
  const [newOptColor, setNewOptColor] = useState("gray");
  const [formulaError, setFormulaError] = useState("");

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
    }
    if (type === "formula") {
      col.formula = formula;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-100 rounded-xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium">
            {isNew ? t.add_column : t.edit_column}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-gray-700">
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
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-muted block mb-1">{t.type}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as WorkloadColumnType)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
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
              <div className="flex-1 border border-gray-200 rounded-md overflow-hidden">
                <div className="flex flex-wrap gap-0.5 p-1.5 max-h-24 overflow-y-auto">
                  <button
                    onClick={() => { setIcon(""); setIconOnly(false); }}
                    className={`p-1 rounded ${!icon ? "bg-accent text-white" : "hover:bg-gray-200 text-muted"}`}
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
                        className={`p-1 rounded ${icon === name ? "bg-accent text-white" : "hover:bg-gray-200 text-muted"}`}
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

          {/* Formula */}
          {type === "formula" && (
            <div>
              <label className="text-xs text-muted block mb-1">{t.formula}</label>
              <input
                value={formula}
                onChange={(e) => handleFormulaChange(e.target.value)}
                placeholder="e.g. og_scope ? hours : 0"
                className={`w-full border rounded-md px-3 py-2 text-sm font-mono ${formulaError ? "border-red-400" : "border-gray-200"}`}
              />
              {formulaError ? (
                <p className="text-[10px] text-red-500 mt-1">{formulaError}</p>
              ) : (
                <p className="text-[10px] text-muted mt-1">{t.formula_help}</p>
              )}
            </div>
          )}

          {/* Select options */}
          {(type === "select" || type === "multi_select") && (
            <div>
              <label className="text-xs text-muted block mb-1">{t.options}</label>
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
                          const next = [...options];
                          next[i] = { ...next[i], color: e.target.value };
                          setOptions(next);
                        }}
                        className="text-xs border border-gray-200 rounded px-1 py-0.5"
                      >
                        {TAG_COLOR_NAMES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setOptions(options.filter((_, j) => j !== i))}
                        className="text-muted hover:text-red-600 ml-auto"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  value={newOptValue}
                  onChange={(e) => setNewOptValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addOption()}
                  placeholder={t.new_option}
                  className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
                />
                <select
                  value={newOptColor}
                  onChange={(e) => setNewOptColor(e.target.value)}
                  className="text-sm border border-gray-200 rounded px-2 py-1.5"
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
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <div>
            {!isNew && onDelete && (
              <button
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                className="text-sm text-red-600 hover:text-red-700"
              >
                {t.delete_column}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50"
            >
              {t.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || (type === "formula" && !!formulaError && !!formula.trim())}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
            >
              {t.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
