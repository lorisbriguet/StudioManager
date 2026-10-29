import { useState, useEffect } from "react";
import { Ban } from "lucide-react";
import { Checkbox, Button, Select, Input, FormModal, Tooltip, FormField, FormGrid, FormGroup, ICONS, ICON_SIZE } from "../ui";
import { notify } from "../../lib/notify";
import type { WorkloadColumn, WorkloadColumnType, SelectOption } from "../../types/workload";
import { COLUMN_ICONS, COLUMN_ICON_NAMES } from "./columnIcons";
import { evaluateFormula } from "../../lib/formulaEval";
import { useT } from "../../i18n/useT";
import { useCustomLists, useCustomListItems, useCreateCustomList, useSetCustomListItems } from "../../db/hooks/useCustomLists";
import { OptionsEditor } from "../shared/OptionsEditor";

interface Props {
  column: WorkloadColumn | null; // null = creating new
  existingKeys?: string[];
  onSave: (column: WorkloadColumn) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const COLUMN_TYPES: WorkloadColumnType[] = ["text", "number", "checkbox", "select", "multi_select", "formula", "link"];

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
  const [formulaError, setFormulaError] = useState("");
  const [linkedListId, setLinkedListId] = useState<number | undefined>(column?.linked_list_id);
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

  const handleSaveAsList = async (listName: string) => {
    const id = await createCustomList.mutateAsync(listName);
    await setCustomListItems.mutateAsync({ listId: id, items: options.map((o) => ({ value: o.value, color: o.color })) });
    notify.success(t.list_created);
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={isNew ? t.add_column : t.edit_column}
      submitLabel={t.save}
      onSubmit={handleSave}
      submitDisabled={!name.trim() || (type === "formula" && !!formulaError && !!formula.trim())}
      destructive={
        !isNew && onDelete ? (
          <Button
            variant="danger"
            icon={ICONS.delete}
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            {t.delete_column}
          </Button>
        ) : undefined
      }
    >
      <FormGrid cols={1}>
        {/* Name */}
        <FormField label={t.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>

        {/* Type */}
        <FormField label={t.type}>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as WorkloadColumnType)}
          >
            {COLUMN_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t[`column_type_${ct}`]}
              </option>
            ))}
          </Select>
        </FormField>

        {/* Icon */}
        <FormGroup label={t.icon}>
          <div className="flex items-center gap-3">
            <div className="flex-1 border border-[var(--color-border-divider)] rounded-md overflow-hidden">
              <div className="flex flex-wrap gap-0.5 p-1.5 max-h-24 overflow-y-auto">
                <Tooltip content={t.none}>
                  <button
                    type="button"
                    onClick={() => { setIcon(""); setIconOnly(false); }}
                    className={`p-1 rounded-md ${!icon ? "bg-accent text-on-accent" : "hover:bg-[var(--color-hover-row)] text-muted"}`}
                    aria-label={t.none}
                  >
                    <Ban size={ICON_SIZE.menu} />
                  </button>
                </Tooltip>
                {COLUMN_ICON_NAMES.map((name) => {
                  const Icon = COLUMN_ICONS[name];
                  return (
                    <Tooltip key={name} content={name}>
                      <button
                        type="button"
                        onClick={() => setIcon(name)}
                        className={`p-1 rounded-md ${icon === name ? "bg-accent text-on-accent" : "hover:bg-[var(--color-hover-row)] text-muted"}`}
                        aria-label={name}
                      >
                        <Icon size={ICON_SIZE.menu} />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
          {icon && (
            <Checkbox
              label={t.icon_only}
              checked={iconOnly}
              onChange={(e) => setIconOnly(e.target.checked)}
              className="mt-2"
            />
          )}
        </FormGroup>

        {/* Calendar color toggle (select/multi_select only) */}
        {(type === "select" || type === "multi_select") && (
          <Checkbox
            label={
              <span className="inline-flex items-center gap-2">
                <ICONS.calendar size={ICON_SIZE.menu} className="shrink-0" />
                {t.calendar_color_column}
              </span>
            }
            checked={calendarColor}
            onChange={(e) => setCalendarColor(e.target.checked)}
          />
        )}

        {/* Formula */}
        {type === "formula" && (
          <FormField label={t.formula} error={formulaError || undefined} hint={t.formula_help}>
            <Input
              value={formula}
              onChange={(e) => handleFormulaChange(e.target.value)}
              placeholder="e.g. og_scope ? hours : 0"
              className="font-mono"
            />
          </FormField>
        )}

        {/* Select options */}
        {(type === "select" || type === "multi_select") && (
          <OptionsEditor
            label={t.options}
            options={options}
            onChange={(next) => setOptions(next.map((o) => ({ value: o.value, color: o.color ?? "gray" })))}
            lists={customLists}
            linkedListId={linkedListId}
            onLink={setImportListId}
            onUnlink={() => setLinkedListId(undefined)}
            onSaveAsList={handleSaveAsList}
          />
        )}
      </FormGrid>
    </FormModal>
  );
}
