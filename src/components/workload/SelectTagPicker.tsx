import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { TAG_COLORS, type SelectOption } from "../../types/workload";

interface Props {
  options: SelectOption[];
  value: string[];
  multi?: boolean;
  onChange: (value: string[]) => void;
  onOptionsChange?: (options: SelectOption[]) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
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
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

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
    const colors = Object.keys(TAG_COLORS);
    const color = colors[options.length % colors.length];
    const newOpt: SelectOption = { value: trimmed, color };
    onOptionsChange?.([...options, newOpt]);
    onChange([...value, trimmed]);
    setSearch("");
  };

  const dropdown = (
    <div
      ref={ref}
      className={`${anchorRef ? "fixed" : "absolute mt-1"} z-50 w-52 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg overflow-hidden`}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      <div className="p-1.5">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && search.trim() && filtered.length === 0) {
              createOption();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search or create..."
          className="w-full text-sm px-2 py-1 border border-[var(--color-border-divider)] rounded"
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((opt) => {
          const c = TAG_COLORS[opt.color] ?? TAG_COLORS.gray;
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
                className={`inline-block px-2 py-0.5 rounded text-xs ${c.bg} ${c.text}`}
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
            Create &quot;{search.trim()}&quot;
          </button>
        )}
      </div>
    </div>
  );

  if (anchorRef) {
    return createPortal(dropdown, document.body);
  }
  return dropdown;
}
