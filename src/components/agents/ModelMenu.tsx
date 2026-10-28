import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ContextMenu } from "../ContextMenu";

export const MODELS = ["haiku", "sonnet", "opus", "fable"];

interface ModelMenuProps {
  value: string | null;
  onChange: (model: string) => void;
  label: string;
  disabled?: boolean;
}

/** A compact model picker using the app's dropdown menu pattern instead of a native select. */
export function ModelMenu({ value, onChange, label, disabled }: ModelMenuProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        disabled={disabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom + 4 });
        }}
        className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-lg border border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-sm focus-accent hover:bg-[var(--color-hover-row)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={value ? "" : "text-muted"}>{value ?? label}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          onClose={() => setAt(null)}
          items={MODELS.map((m) => ({
            label: m,
            icon: <Check size={14} className={m === value ? "" : "invisible"} />,
            onClick: () => {
              setAt(null);
              if (m !== value) onChange(m);
            },
          }))}
        />
      )}
    </>
  );
}
