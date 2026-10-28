import { useState } from "react";
import { X } from "lucide-react";
import type { SelectOption } from "../../types/workload";
import { getStoredTagColor, TAG_COLOR_NAMES } from "../../lib/tagColors";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import { Popover } from "../ui/Popover";

interface Props {
  options: SelectOption[];
  value: string[];
  multi?: boolean;
  onChange: (value: string[]) => void;
  onOptionsChange?: (options: SelectOption[]) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function SelectTagPicker({
  options,
  value,
  multi = false,
  onChange,
  onOptionsChange,
  onClose,
  anchorRef,
}: Props) {
  const t = useT();
  const [search, setSearch] = useState("");
  const darkMode = useAppStore((s) => s.darkMode);

  const filtered = options.filter((o) =>
    o.value.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (optValue: string) => {
    if (multi) {
      const next = value.includes(optValue)
        ? value.filter((v) => v !== optValue)
        : [...value, optValue];
      onChange(next);
    } else {
      onChange(value.includes(optValue) ? [] : [optValue]);
      onClose();
    }
  };

  const createOption = () => {
    const trimmed = search.trim();
    if (!trimmed || options.some((o) => o.value === trimmed)) return;
    const color = TAG_COLOR_NAMES[options.length % TAG_COLOR_NAMES.length];
    const newOpt: SelectOption = { value: trimmed, color };
    onOptionsChange?.([...options, newOpt]);
    onChange([...value, trimmed]);
    setSearch("");
  };

  return (
    <Popover anchor={anchorRef} onClose={onClose} padding="none" className="w-52 overflow-hidden">
      <div className="p-1.5">
        <input
          data-autofocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && search.trim() && filtered.length === 0) {
              createOption();
            }
          }}
          placeholder={t.search_or_create}
          className="w-full text-sm px-2 py-1 border border-[var(--color-border-divider)] rounded-lg"
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((opt) => {
          const c = getStoredTagColor(opt.color, darkMode);
          const selected = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-hover-row)] ${
                selected ? "bg-[var(--color-hover-row)]" : ""
              }`}
            >
              <span
                style={{ background: c.bg, color: c.text }}
                className="inline-block px-2 py-0.5 rounded-full text-xs"
              >
                {opt.value}
              </span>
              {selected && (
                <X size={12} className="ml-auto text-muted shrink-0" />
              )}
            </button>
          );
        })}
        {search.trim() && !options.some((o) => o.value === search.trim()) && (
          <button
            onClick={createOption}
            className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-[var(--color-hover-row)]"
          >
            {t.create} &quot;{search.trim()}&quot;
          </button>
        )}
      </div>
    </Popover>
  );
}
