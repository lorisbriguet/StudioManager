import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { CONTROL_BOX, MUTED_INTERACTIVE } from "./tokens";

/**
 * SegmentedControl — pick one of a few options shown side by side
 * (calendar view, logo position). See DESIGN-SYSTEM.md, "Segmented control".
 *
 *   <SegmentedControl
 *     aria-label={t.view}
 *     value={view}
 *     onChange={setView}
 *     options={[{ value: "month", label: t.month }, { value: "week", label: t.week }]}
 *   />
 *
 * A radio group: one tab stop, arrow keys move and select.
 * For more than ~4 options, or options that need a description, use Select or radios.
 */

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
  "aria-label": string;
  size?: "sm" | "md";
  /** Stretch to the container, segments share the width. */
  fullWidth?: boolean;
  className?: string;
}

// sm is 26px tall in total, like every other control (tokens.ts CONTROL_BOX):
//   track p-0.5            2 + 2  =  4
//   segment py-0.5         2 + 2  =  4
//   segment line leading-4        = 16
//   segment border         1 + 1  =  2
//                                   26
// So a segment is CONTROL_BOX with 1px less padding top and bottom (22px);
// its border stays, transparent, so the box is the same as the others.
const SEGMENT_BOX = CONTROL_BOX.replace("py-1", "py-0.5");

const SIZE = {
  sm: `${SEGMENT_BOX} border-transparent`,
  md: "px-3.5 py-1.5 text-sm",
};

export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  size = "sm",
  fullWidth = false,
  className = "",
  ...aria
}: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | undefined;
    const at = enabled.indexOf(options.findIndex((o) => o.value === value));
    if (e.key in keys) next = enabled[(at + keys[e.key] + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      onKeyDown={onKeyDown}
      className={`${fullWidth ? "flex w-full" : "inline-flex"} gap-0.5 p-0.5 rounded-lg bg-[var(--color-input-bg)] ${className}`}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => !on && onChange(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors focus-accent disabled:opacity-40 disabled:cursor-not-allowed ${
              SIZE[size]
            } ${fullWidth ? "flex-1" : ""} ${
              on
                ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-control"
                : MUTED_INTERACTIVE
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
