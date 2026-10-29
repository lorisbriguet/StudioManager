import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Input } from "./Input";
import { Kbd } from "./Kbd";
import { Popover } from "./Popover";
import { SECTION_LABEL } from "./SectionLabel";
import { CONTROL_BOX } from "./tokens";
import { ICON_SIZE, ICON_STROKE, renderIcon, type IconProp } from "./icons";

/**
 * Dropdown — the app's one menu component (see DESIGN-SYSTEM.md, "Dropdown").
 *
 *   <DropdownSelect value={v} onChange={setV} options={[...]} />   pick a value
 *   <DropdownSelect multiple value={tags} onChange={setTags} ... /> pick several
 *   <Dropdown trigger={<Button .../>} items={[...]} />              run a command
 *
 * The panel is a Popover (./Popover.tsx): on <body>, fixed under its
 * trigger, never clipped, flips above when there is no room below.
 *
 * Shared classes below are also used by ContextMenu, so every menu in the app
 * looks the same.
 */

export const MENU_ITEM =
  "w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left select-none transition-colors outline-none";
export const MENU_DIVIDER = "my-1 border-t border-[var(--color-border-divider)]";
export const MENU_GROUP_LABEL = `px-2 pt-2 pb-1 ${SECTION_LABEL}`;

/** Menu row tones, shared by Dropdown and ContextMenu. */
export const MENU_TONE = {
  base: "text-[var(--color-text-secondary)] cursor-pointer",
  active: "bg-[var(--color-hover-row)] text-[var(--color-text)] cursor-pointer",
  selected: "text-accent font-medium bg-accent-tint cursor-pointer",
  selectedActive: "text-accent font-medium bg-accent-tint-strong cursor-pointer",
  danger: "text-[var(--color-danger-text)] cursor-pointer",
  dangerActive: "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] cursor-pointer",
  disabled: "text-muted opacity-50 cursor-not-allowed",
};

// ─── Panel ──────────────────────────────────────────────────────────────

type Row =
  | {
      kind: "item";
      key: string;
      label: string;
      description?: string;
      icon?: IconProp;
      meta?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      /** single select: this is the current value */
      selected?: boolean;
      /** multi select: checkbox state (undefined = no checkbox) */
      checked?: boolean;
      create?: boolean;
      onPick: () => void;
    }
  | { kind: "divider"; key: string }
  | { kind: "group"; key: string; label: string };

interface MenuPanelProps {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  rows: Row[];
  role: "menu" | "listbox";
  multiselectable?: boolean;
  align?: "start" | "end";
  /** returnFocus: put focus back on the trigger (keyboard, pick); false on outside click */
  onClose: (returnFocus: boolean) => void;
  keepOpenOnPick?: boolean;
  search?: { value: string; onChange: (q: string) => void; placeholder: string };
  emptyText: string;
  initialActive?: number;
}

function MenuPanel({
  id,
  anchor,
  rows,
  role,
  multiselectable,
  align = "start",
  onClose,
  keepOpenOnPick,
  search,
  emptyText,
  initialActive,
}: MenuPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const enabled = rows.flatMap((r, i) => (r.kind === "item" && !r.disabled ? [i] : []));
  const [active, setActive] = useState(() =>
    initialActive !== undefined && initialActive >= 0 ? initialActive : -1
  );
  // Filtering can remove the active row; fall back to the first one.
  const current = enabled.includes(active) ? active : (enabled[0] ?? -1);

  useEffect(() => {
    (searchRef.current ?? listRef.current)?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(`${id}-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, current]);

  const pick = (i: number) => {
    const r = rows[i];
    if (!r || r.kind !== "item" || r.disabled) return;
    r.onPick();
    if (!keepOpenOnPick || r.create) onCloseRef.current(true);
  };

  const typeahead = useRef({ buf: "", at: 0 });
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const move = (d: number) => {
      if (!enabled.length) return;
      const at = enabled.indexOf(current);
      setActive(enabled[(at + d + enabled.length) % enabled.length]);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        return;
      case "Home":
        if (search) return;
        e.preventDefault();
        if (enabled.length) setActive(enabled[0]);
        return;
      case "End":
        if (search) return;
        e.preventDefault();
        if (enabled.length) setActive(enabled[enabled.length - 1]);
        return;
      case "Enter":
        e.preventDefault();
        if (current >= 0) pick(current);
        return;
      case " ":
        if (search) return;
        e.preventDefault();
        if (current >= 0) pick(current);
        return;
      case "Tab":
        e.preventDefault();
        onCloseRef.current(true);
        return;
    }
    if (!search && e.key.length === 1 && !e.metaKey && !e.ctrlKey && /\S/.test(e.key)) {
      const now = Date.now();
      const ta = typeahead.current;
      ta.buf = now - ta.at > 500 ? e.key.toLowerCase() : ta.buf + e.key.toLowerCase();
      ta.at = now;
      const hit = enabled.find((i) => {
        const r = rows[i];
        return r.kind === "item" && r.label.toLowerCase().startsWith(ta.buf);
      });
      if (hit !== undefined) setActive(hit);
    }
  };

  const activeId = current >= 0 ? `${id}-${current}` : undefined;

  return (
    <Popover
      anchor={anchor}
      align={align}
      matchWidth
      autoFocus={false}
      onClose={onClose}
      onKeyDown={onKeyDown}
      className="flex flex-col max-w-80"
    >
      {search && (
        <div className="-mx-1 -mt-1 mb-1 p-1 border-b border-[var(--color-border-divider)]">
          <Input
            ref={searchRef}
            type="text"
            variant="bare"
            icon={Search}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            aria-controls={id}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
          />
        </div>
      )}
      <div
        ref={listRef}
        id={id}
        role={role}
        aria-multiselectable={multiselectable || undefined}
        aria-activedescendant={search ? undefined : activeId}
        tabIndex={-1}
        className="max-h-72 overflow-y-auto flex flex-col outline-none"
      >
        {rows.length === 0 && emptyText && <div className="px-2 py-3 text-xs text-muted text-center">{emptyText}</div>}
        {rows.map((r, i) => {
          if (r.kind === "divider") return <div key={r.key} role="separator" className={MENU_DIVIDER} />;
          if (r.kind === "group")
            return (
              <div key={r.key} role="presentation" className={MENU_GROUP_LABEL}>
                {r.label}
              </div>
            );
          const isActive = i === current;
          const tone = r.disabled
            ? MENU_TONE.disabled
            : r.danger
              ? isActive ? MENU_TONE.dangerActive : MENU_TONE.danger
              : r.selected
                ? isActive ? MENU_TONE.selectedActive : MENU_TONE.selected
                : isActive ? MENU_TONE.active : MENU_TONE.base;
          const itemRole = role === "listbox" ? "option" : r.checked !== undefined ? "menuitemcheckbox" : "menuitem";
          return (
            <div
              key={r.key}
              id={`${id}-${i}`}
              role={itemRole}
              aria-selected={role === "listbox" ? Boolean(r.selected || r.checked) : undefined}
              aria-checked={itemRole === "menuitemcheckbox" ? r.checked : undefined}
              aria-disabled={r.disabled || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => {
                if (!r.disabled && i !== current) setActive(i);
              }}
              onClick={() => pick(i)}
              className={`${MENU_ITEM} ${tone} ${r.create ? "text-accent" : ""}`}
            >
              {r.checked !== undefined && (
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    r.checked
                      ? "bg-accent border-accent text-on-accent"
                      : "bg-[var(--color-input-bg)] border-[var(--color-input-border)]"
                  }`}
                >
                  {r.checked && <Check size={ICON_SIZE.pill} strokeWidth={ICON_STROKE.check} />}
                </span>
              )}
              {r.icon != null && r.icon !== false && (
                <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${r.danger || r.create ? "" : "text-muted"}`}>
                  {renderIcon(r.icon, ICON_SIZE.menu)}
                </span>
              )}
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="truncate">{r.label}</span>
                {r.description && <span className="text-xs text-muted font-normal truncate">{r.description}</span>}
              </span>
              {r.meta != null && <span className="text-xs text-muted tabular-nums shrink-0">{r.meta}</span>}
              {r.shortcut && <Kbd>{r.shortcut}</Kbd>}
              {role === "listbox" && r.checked === undefined && (
                <Check size={ICON_SIZE.menu} className={`shrink-0 text-accent ${r.selected ? "" : "invisible"}`} />
              )}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

// ─── DropdownSelect ─────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  /** A lucide component (14px in the menu, 12px in the trigger) or an element. */
  icon?: IconProp;
  meta?: ReactNode;
  disabled?: boolean;
  /** Options sharing a group are listed under a section label. Keep them adjacent. */
  group?: string;
}

interface DropdownSelectCommon {
  options: DropdownOption[];
  /** Shown muted when nothing is selected. */
  placeholder?: string;
  /** Search field at the top. Default: on when there are more than 10 options. */
  searchable?: boolean;
  /** Adds a "Create …" row when the search matches no option. */
  onCreate?: (query: string) => void;
  /** default: the thin 26px filled trigger (the shared control box). bare: no fill, for table cells. */
  variant?: "default" | "bare";
  /** Muted label inside the trigger, before the value ("Status:"). */
  prefix?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  title?: string;
  align?: "start" | "end";
  /** Open on mount (inline cell editors). */
  defaultOpen?: boolean;
  autoFocus?: boolean;
  /** Called when focus leaves the dropdown (trigger and panel). */
  onBlur?: () => void;
  /** Called when the trigger gets focus (e.g. lazy-load the options). */
  onFocus?: () => void;
  renderValue?: (selected: DropdownOption[]) => ReactNode;
  "aria-label"?: string;
  "aria-required"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  "data-testid"?: string;
}

export type DropdownSelectProps = DropdownSelectCommon &
  (
    | { multiple?: false; value: string; onChange: (value: string) => void }
    | { multiple: true; value: string[]; onChange: (value: string[]) => void }
  );

const TRIGGER_BASE =
  "focus-accent inline-flex items-center text-left min-w-0 max-w-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const TRIGGER_SIZE = {
  // 26px, the shared control box (tokens.ts), filled instead of framed.
  default: `gap-1.5 rounded-md ${CONTROL_BOX} border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] aria-expanded:bg-[var(--color-hover-row)]`,
  // No colour of its own: a bare trigger takes its parent's, or a status pill's classes.
  bare: "gap-1 text-xs bg-transparent border-0 p-0",
};

export function DropdownSelect(props: DropdownSelectProps) {
  const {
    options,
    placeholder,
    searchable,
    onCreate,
    variant = "default",
    prefix,
    fullWidth = true,
    disabled,
    id,
    className = "",
    title,
    align,
    defaultOpen,
    autoFocus,
    onBlur,
    onFocus,
    renderValue,
  } = props;
  const t = useT();
  const autoId = useId();
  const menuId = `${autoId}-menu`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(Boolean(defaultOpen && !disabled));
  const [query, setQuery] = useState("");
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  const selectedValues = props.multiple ? props.value : [props.value];
  const selected = options.filter((o) => selectedValues.includes(o.value));
  const withSearch = searchable ?? options.length > 10;

  useEffect(() => {
    if (autoFocus || defaultOpen) triggerRef.current?.focus({ preventScroll: true });
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    else onBlurRef.current?.();
  }, []);

  const pick = (v: string) => {
    if (props.multiple) {
      const next = props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v];
      props.onChange(next);
    } else if (v !== props.value) {
      props.onChange(v);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q))
    : options;
  const rows: Row[] = [];
  let group: string | undefined;
  visible.forEach((o, i) => {
    if (o.group !== group) {
      group = o.group;
      if (group) {
        if (rows.length) rows.push({ kind: "divider", key: `d-${i}` });
        rows.push({ kind: "group", key: `g-${i}`, label: group });
      }
    }
    const isSel = selectedValues.includes(o.value);
    rows.push({
      kind: "item",
      key: `o-${i}-${o.value}`,
      label: o.label,
      description: o.description,
      icon: o.icon,
      meta: o.meta,
      disabled: o.disabled,
      selected: props.multiple ? undefined : isSel,
      checked: props.multiple ? isSel : undefined,
      onPick: () => pick(o.value),
    });
  });
  if (q && onCreate && !options.some((o) => o.label.toLowerCase() === q)) {
    const text = query.trim();
    if (rows.length) rows.push({ kind: "divider", key: "d-create" });
    rows.push({
      kind: "item",
      key: "create",
      label: `${t.create} “${text}”`,
      icon: Plus,
      create: true,
      onPick: () => onCreate(text),
    });
  }
  const initialActive = props.multiple ? -1 : rows.findIndex((r) => r.kind === "item" && r.selected);

  const empty = selected.length === 0;
  const display = renderValue
    ? renderValue(selected)
    : empty
      ? placeholder ?? ""
      : selected.map((o) => o.label).join(", ");
  const icon = !props.multiple && selected[0]?.icon;
  const look = TRIGGER_SIZE[variant];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={props["aria-label"]}
        aria-required={props["aria-required"]}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
        data-testid={props["data-testid"]}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onFocus={onFocus}
        onBlur={(e) => {
          if (open) return; // focus moved into the panel
          if (e.relatedTarget && document.getElementById(menuId)?.contains(e.relatedTarget as Node)) return;
          onBlur?.();
        }}
        className={`${TRIGGER_BASE} ${look} ${fullWidth ? "w-full" : ""} ${className}`}
      >
        {prefix && <span className="text-muted shrink-0">{prefix}</span>}
        {icon != null && icon !== false && <span className="shrink-0 flex items-center">{renderIcon(icon, ICON_SIZE.control)}</span>}
        <span className={`flex-1 min-w-0 truncate ${empty && !renderValue ? "text-muted" : ""}`}>{display}</span>
        <ChevronDown
          size={ICON_SIZE.control}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <MenuPanel
          id={menuId}
          anchor={triggerRef}
          rows={rows}
          role="listbox"
          multiselectable={props.multiple}
          align={align}
          onClose={close}
          keepOpenOnPick={props.multiple}
          search={withSearch ? { value: query, onChange: setQuery, placeholder: t.search } : undefined}
          emptyText={t.no_results}
          initialActive={initialActive}
        />
      )}
    </>
  );
}

// ─── Dropdown (action menu) ─────────────────────────────────────────────

export type DropdownItem =
  | {
      label: string;
      onSelect: () => void;
      /** A lucide component (drawn at 14px) or an element. */
      icon?: IconProp;
      description?: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
    }
  | { divider: true }
  | { group: string };

interface DropdownProps {
  /** Any button. It gets aria-haspopup / aria-expanded; clicks on it toggle the menu. */
  trigger: ReactElement<{ "aria-haspopup"?: string; "aria-expanded"?: boolean }>;
  items: DropdownItem[];
  align?: "start" | "end";
  className?: string;
}

export function Dropdown({ trigger, items, align = "start", className = "" }: DropdownProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const menuId = `${useId()}-menu`;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    const el = returnTo.current;
    if (returnFocus && el?.isConnected) el.focus({ preventScroll: true });
  }, []);

  const rows: Row[] = items.map((it, i) =>
    "divider" in it
      ? { kind: "divider", key: `d-${i}` }
      : "group" in it
        ? { kind: "group", key: `g-${i}`, label: it.group }
        : {
            kind: "item",
            key: `i-${i}`,
            label: it.label,
            icon: it.icon,
            description: it.description,
            shortcut: it.shortcut,
            danger: it.danger,
            disabled: it.disabled,
            onPick: it.onSelect,
          }
  );

  return (
    <span
      ref={anchorRef}
      className={`inline-flex ${className}`}
      onClick={(e) => {
        if (!anchorRef.current?.contains(e.target as Node)) return;
        if (open) return close(true);
        returnTo.current = (e.target as HTMLElement).closest("button") ?? anchorRef.current;
        setOpen(true);
      }}
      onKeyDown={(e) => {
        if (!anchorRef.current?.contains(e.target as Node)) return;
        if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          returnTo.current = (e.target as HTMLElement).closest("button") ?? anchorRef.current;
          setOpen(true);
        }
      }}
    >
      {cloneElement(trigger, { "aria-haspopup": "menu", "aria-expanded": open })}
      {open && (
        <MenuPanel
          id={menuId}
          anchor={anchorRef}
          rows={rows}
          role="menu"
          align={align}
          onClose={close}
          emptyText=""
          initialActive={rows.findIndex((r) => r.kind === "item" && !r.disabled)}
        />
      )}
    </span>
  );
}
