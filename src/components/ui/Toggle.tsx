import type { ReactNode } from "react";
import { Labelled } from "./Checkbox";

/**
 * Toggle — an on/off switch.
 *
 *   <Toggle checked={on} onChange={setOn} ariaLabel={t.show_income} />
 *   <Toggle checked={on} onChange={setOn} label={t.show_income} description={t.show_income_desc} />
 *
 * With `label`, it sits in Checkbox's label wrapper (clicking the text toggles).
 */
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /**
   * Accessible name for the switch (Phase 2 E3). Required at call sites whose
   * visible label is not programmatically associated (e.g. a plain text label
   * sitting next to the toggle) — duplicate that label text here.
   */
  ariaLabel?: string;
  /** Text beside the switch; names it and toggles on click. */
  label?: ReactNode;
  description?: ReactNode;
  /** sm: compact rows inside popovers (date picker options). */
  size?: "sm" | "md";
  className?: string;
}

const SIZE = {
  // offset: centres the track on the label's 20px first line
  md: { track: "h-5 w-9", knob: "h-4 w-4", on: "translate-x-[18px]", offset: "mt-0" },
  sm: { track: "h-4.5 w-8", knob: "h-3.5 w-3.5", on: "translate-x-4", offset: "mt-px" },
};

export function Toggle({ checked, onChange, disabled, ariaLabel, label, description, size = "md", className = "" }: ToggleProps) {
  const sz = SIZE[size];
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex ${sz.track} shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-accent disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-accent" : "bg-[var(--color-input-bg)]"
      } ${label ? "" : className}`}
    >
      <span
        className={`pointer-events-none inline-block ${sz.knob} rounded-full bg-white shadow-sm transition-transform duration-200 translate-y-0.5 ${
          checked ? sz.on : "translate-x-0.5"
        }`}
      />
    </button>
  );
  if (!label) return control;
  return (
    <Labelled label={label} description={description} disabled={disabled} className={className} boxOffset={sz.offset}>
      {control}
    </Labelled>
  );
}
