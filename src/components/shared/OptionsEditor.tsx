import { useRef, useState, type ReactNode } from "react";
import { AddRow, Badge, Button, Dropdown, FormGroup, ICONS, ICON_SIZE, IconButton, Input, Select, Tag, FORM_GAP } from "../ui";
import { normalizeTagColorName, TAG_COLOR_NAMES } from "../../lib/tagColors";
import { useT } from "../../i18n/useT";

/** One option: a name and, when the editor has colours, a tag colour. */
export interface EditableOption {
  value: string;
  color?: string;
}

export interface OptionsEditorProps {
  options: EditableOption[];
  onChange: (options: EditableOption[]) => void;
  /** The group label ("Options"). Without it there is no label row (and no import/unlink action). */
  label?: ReactNode;
  /**
   * On (default): each option shows as its Tag with a colour picker.
   * Off: plain names, renamed in place (named tables).
   */
  colors?: boolean;
  /** Placeholder and "+" label of the add row. Default: t.new_option. */
  addLabel?: string;
  /** Custom lists offered by "Import from list". */
  lists?: { id: number; name: string }[];
  /** The custom list the options come from. While set, the options are read-only. */
  linkedListId?: number;
  /** Turns on "Import from list" (in the label row). */
  onLink?: (listId: number) => void;
  /** Turns on "Unlink" while linked. */
  onUnlink?: () => void;
  /** Turns on "Save as list": saves the options as a new custom list with this name. */
  onSaveAsList?: (name: string) => void | Promise<void>;
}

/** The tag colour picker of an option row and of the add row. */
function TagColorSelect({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} fullWidth={false} aria-label={t.color}>
      {TAG_COLOR_NAMES.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </Select>
  );
}

/**
 * The options of a select column or the items of a custom list: one row per
 * option (its Tag and colour, or its name), remove, an add row (Enter adds),
 * and optionally import from / save as a custom list. See DESIGN-SYSTEM.md,
 * "Forms" (Options editor). It holds no data: the caller owns the options and
 * the custom-list calls.
 */
export function OptionsEditor({
  options,
  onChange,
  label,
  colors = true,
  addLabel,
  lists = [],
  linkedListId,
  onLink,
  onUnlink,
  onSaveAsList,
}: OptionsEditorProps) {
  const t = useT();
  const linked = linkedListId !== undefined;
  const addText = addLabel ?? t.new_option;

  const [newColor, setNewColor] = useState("gray");
  const [savingAsList, setSavingAsList] = useState(false);
  const [listName, setListName] = useState("");

  // A stable key per row, so removing an earlier option doesn't move the
  // field being typed in (an index key did: it lost focus). Names can't be
  // keys: they change on every keystroke. Kept in step with our own removes
  // and adds; a change from outside (import from list) that alters the count
  // gives fresh keys.
  const nextKey = useRef(0);
  const keys = useRef<number[]>([]);
  if (keys.current.length !== options.length) {
    keys.current = options.map(() => nextKey.current++);
  }

  const update = (i: number, patch: Partial<EditableOption>) => {
    if (linked) return;
    const next = [...options];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const remove = (i: number) => {
    keys.current = keys.current.filter((_, j) => j !== i);
    onChange(options.filter((_, j) => j !== i));
  };

  /** A duplicate name is ignored and stays in the field. */
  const add = (value: string) => {
    if (options.some((o) => o.value === value)) return false;
    keys.current = [...keys.current, nextKey.current++];
    onChange([...options, colors ? { value, color: newColor } : { value }]);
  };

  const saveAsList = async () => {
    const name = listName.trim();
    if (!name || options.length === 0 || !onSaveAsList) return;
    await onSaveAsList(name);
    setSavingAsList(false);
    setListName("");
  };

  const action = linked ? (
    <div className="flex items-center gap-1.5">
      <Badge variant="accent" size="xs">
        <ICONS.link size={ICON_SIZE.pill} />
        {lists.find((l) => l.id === linkedListId)?.name ?? ""}
      </Badge>
      {onUnlink && (
        <Button variant="link" icon={ICONS.unlink} onClick={onUnlink} className="text-muted hover:text-accent-text">
          {t.unlink_list}
        </Button>
      )}
    </div>
  ) : onLink ? (
    <Dropdown
      align="end"
      trigger={<Button variant="link" icon={ICONS.link}>{t.import_from_list}</Button>}
      items={
        lists.length === 0
          ? [{ label: t.no_lists, disabled: true, onSelect: () => {} }]
          : lists.map((l) => ({ label: l.name, onSelect: () => onLink(l.id) }))
      }
    />
  ) : undefined;

  const body = (
    <div className={`flex flex-col ${FORM_GAP}`}>
      {options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <div key={keys.current[i]} className="flex items-center gap-2">
              {colors ? (
                <>
                  <div className="flex-1 min-w-0">
                    <Tag name={opt.value} color={opt.color} />
                  </div>
                  <TagColorSelect
                    value={normalizeTagColorName(opt.color ?? "gray")}
                    onChange={(color) => update(i, { color })}
                    disabled={linked}
                  />
                </>
              ) : (
                <Input
                  value={opt.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  readOnly={linked}
                  aria-label={`${t.options} ${i + 1}`}
                  className="flex-1"
                />
              )}
              {!linked && (
                <IconButton
                  icon={ICONS.delete}
                  label={t.delete}
                  size="xs"
                  tone="danger"
                  onClick={() => remove(i)}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {!linked && (
        // The editor sits inside forms: AddRow's Enter adds, it doesn't submit.
        <AddRow placeholder={addText} size="xs" onAdd={add}>
          {colors && <TagColorSelect value={newColor} onChange={setNewColor} />}
        </AddRow>
      )}
      {!linked && onSaveAsList && (
        savingAsList ? (
          <div className="flex items-center gap-2">
            <Input
              fullWidth={false}
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveAsList();
                }
                // Esc closes only this field, not the surrounding dialog or popover.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSavingAsList(false);
                }
              }}
              placeholder={t.list_name}
              aria-label={t.list_name}
              className="flex-1"
              autoFocus
            />
            <Button onClick={saveAsList}>{t.save}</Button>
            <IconButton icon={ICONS.close} label={t.cancel} size="xs" onClick={() => setSavingAsList(false)} />
          </div>
        ) : (
          <div>
            <Button variant="link" icon={ICONS.link} onClick={() => setSavingAsList(true)} className="text-muted hover:text-accent-text">
              {t.save_as_list}
            </Button>
          </div>
        )
      )}
    </div>
  );

  return label ? (
    <FormGroup label={label} action={action}>
      {body}
    </FormGroup>
  ) : (
    body
  );
}
