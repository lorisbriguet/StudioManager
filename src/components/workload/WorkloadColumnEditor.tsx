import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, Calendar, Link, Unlink } from "lucide-react";
import { Checkbox, Button, Select, Popover, Tag, Input, Modal, Tooltip } from "../ui";
import { MENU_ITEM } from "../ui/Dropdown";
import { toast } from "sonner";
import type { WorkloadColumn, WorkloadColumnType, SelectOption } from "../../types/workload";
import { normalizeTagColorName, TAG_COLOR_NAMES } from "../../lib/tagColors";
import { COLUMN_ICONS, COLUMN_ICON_NAMES } from "./columnIcons";
import { evaluateFormula } from "../../lib/formulaEval";
import { useT } from "../../i18n/useT";
import { useCustomLists, useCustomListItems, useCreateCustomList, useSetCustomListItems } from "../../db/hooks/useCustomLists";
import { IconButton } from "../ui/IconButton";

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
  const importListAnchorRef = useRef<HTMLDivElement>(null);

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
      const base = key;
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
    <Modal
      open
      onClose={onClose}
      title={isNew ? t.add_column : t.edit_column}
      size="md"
      footer={
        <>
          {!isNew && onDelete && (
            <Button
              variant="outline"
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="mr-auto text-[var(--color-danger-text)] hover:text-red-700"
            >
              {t.delete_column}
            </Button>
          )}
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
        </>
      }
    >
      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="text-xs text-muted block mb-1">{t.name}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            autoFocus
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-xs text-muted block mb-1">{t.type}</label>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as WorkloadColumnType)}
          >
            {COLUMN_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value}>
                {ct.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Icon */}
        <div>
          <label className="text-xs text-muted block mb-1">{t.icon}</label>
          <div className="flex items-center gap-3">
            <div className="flex-1 border border-[var(--color-border-divider)] rounded-md overflow-hidden">
              <div className="flex flex-wrap gap-0.5 p-1.5 max-h-24 overflow-y-auto">
                <Tooltip content={t.none}>
                  <button
                    onClick={() => { setIcon(""); setIconOnly(false); }}
                    className={`p-1 rounded-md ${!icon ? "bg-accent text-white" : "hover:bg-[var(--color-hover-row)] text-muted"}`}
                    aria-label={t.none}
                  >
                    <X size={14} />
                  </button>
                </Tooltip>
                {COLUMN_ICON_NAMES.map((name) => {
                  const Icon = COLUMN_ICONS[name];
                  return (
                    <Tooltip key={name} content={name}>
                      <button
                        onClick={() => setIcon(name)}
                        className={`p-1 rounded-md ${icon === name ? "bg-accent text-white" : "hover:bg-[var(--color-hover-row)] text-muted"}`}
                        aria-label={name}
                      >
                        <Icon size={14} />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
          {icon && (
            <label className="flex items-center gap-2 mt-2 text-xs text-muted cursor-pointer">
              <Checkbox
                checked={iconOnly}
                onChange={(e) => setIconOnly(e.target.checked)}
              />
              {t.icon_only}
            </label>
          )}
        </div>

        {/* Calendar color toggle (select/multi_select only) */}
        {(type === "select" || type === "multi_select") && (
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
            <Checkbox
              checked={calendarColor}
              onChange={(e) => setCalendarColor(e.target.checked)}
            />
            <Calendar size={14} className="shrink-0" />
            {t.calendar_color_column}
          </label>
        )}

        {/* Formula */}
        {type === "formula" && (
          <div>
            <label className="text-xs text-muted block mb-1">{t.formula}</label>
            <Input
              value={formula}
              onChange={(e) => handleFormulaChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="e.g. og_scope ? hours : 0"
              aria-invalid={formulaError ? true : undefined}
              className="font-mono aria-[invalid=true]:border-danger-text"
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
                  <Button
                    type="button"
                    variant="link"
                    icon={<Unlink size={12} />}
                    onClick={() => setLinkedListId(undefined)}
                    className="text-muted hover:text-[var(--color-danger-text)]"
                  >
                    {t.unlink_list}
                  </Button>
                </div>
              ) : (
                <div ref={importListAnchorRef}>
                  <Button
                    type="button"
                    variant="link"
                    icon={<Link size={12} />}
                    onClick={() => setShowImportListDropdown((v) => !v)}
                    aria-haspopup="dialog"
                    aria-expanded={showImportListDropdown}
                  >
                    {t.import_from_list}
                  </Button>
                  {showImportListDropdown && (
                    <Popover
                      anchor={importListAnchorRef}
                      align="end"
                      onClose={(returnFocus) => {
                        setShowImportListDropdown(false);
                        if (returnFocus) importListAnchorRef.current?.querySelector("button")?.focus({ preventScroll: true });
                      }}
                    >
                      {(customLists ?? []).length === 0 ? (
                        <p className="text-xs text-muted px-2 py-1">{t.no_lists}</p>
                      ) : (
                        (customLists ?? []).map((list) => (
                          <button
                            key={list.id}
                            type="button"
                            onClick={() => setImportListId(list.id)}
                            className={`${MENU_ITEM} text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]`}
                          >
                            {list.name}
                          </button>
                        ))
                      )}
                    </Popover>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5 mb-2">
              {options.map((opt, i) => {
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Tag name={opt.value} color={opt.color} />
                    <Select
                      value={normalizeTagColorName(opt.color)}
                      onChange={(e) => {
                        if (linkedListId) return;
                        const next = [...options];
                        next[i] = { ...next[i], color: e.target.value };
                        setOptions(next);
                      }}
                      disabled={!!linkedListId}
                      fullWidth={false}
                    >
                      {TAG_COLOR_NAMES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                    {!linkedListId && (
                      <IconButton
                        icon={Trash2}
                        label={t.delete}
                        tone="danger"
                        className="ml-auto"
                        onClick={() => setOptions(options.filter((_, j) => j !== i))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {!linkedListId && (
              <>
                <div className="flex gap-2 mb-2">
                  <Input size="sm" fullWidth={false}
                    value={newOptValue}
                    onChange={(e) => setNewOptValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addOption()}
                    placeholder={t.new_option}
                    className="flex-1"
                  />
                  <Select
                    value={newOptColor}
                    onChange={(e) => setNewOptColor(e.target.value)}
                    fullWidth={false}
                  >
                    {TAG_COLOR_NAMES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                  <IconButton icon={Plus} label={t.new_option} tone="accent" onClick={addOption} />
                </div>
                <div className="border-t border-[var(--color-border-divider)] pt-2">
                  {showSaveAsListInput ? (
                    <div className="flex gap-2">
                      <Input size="sm" fullWidth={false}
                        value={saveAsListName}
                        onChange={(e) => setSaveAsListName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveAsList();
                          // Esc closes only the inline input, not the whole dialog.
                          if (e.key === "Escape") { e.stopPropagation(); setShowSaveAsListInput(false); }
                        }}
                        placeholder={t.list_name}
                        className="flex-1"
                        autoFocus
                      />
                      <button type="button" onClick={handleSaveAsList} className="px-3 text-sm text-accent hover:underline">{t.save}</button>
                      <IconButton icon={X} label={t.cancel} className="mx-1" onClick={() => setShowSaveAsListInput(false)} />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="link"
                      icon={<Link size={12} />}
                      onClick={() => setShowSaveAsListInput(true)}
                      className="text-muted hover:text-accent"
                    >
                      {t.save_as_list}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
