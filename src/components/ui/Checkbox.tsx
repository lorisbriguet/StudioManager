import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Check, Minus } from "lucide-react";
import { ICON_SIZE, ICON_STROKE } from "./icons";

/**
 * Checkbox and Radio. See DESIGN-SYSTEM.md, "Checkbox".
 *
 *   <Checkbox checked={done} onChange={(e) => toggle(e.target.checked)} aria-label={t.done} />
 *   <Checkbox checked={all} indeterminate={some} onChange={selectAll} aria-label={t.select_all} />
 *   <Checkbox label={t.show_income} description={t.show_income_desc} checked={…} onChange={…} />
 *   <Radio name="seed" label={t.start_empty} description={…} checked={!seed} onChange={() => setSeed(false)} />
 *
 * A real <input> underneath, restyled: every native prop and event works
 * (shiftKey on the change event, e.target, onClick stopPropagation, ref).
 * 14px, the same box Dropdown uses for multi-select rows.
 */

interface BaseProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Text beside the box; clicking it toggles. Without it, pass aria-label. */
  label?: ReactNode;
  description?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

const BOX =
  "peer appearance-none shrink-0 w-3.5 h-3.5 m-0 border border-checkbox-border bg-[var(--color-input-bg)] cursor-pointer transition-colors focus-accent checked:bg-accent checked:border-accent disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * The label wrapper Checkbox, Radio and Toggle share: the control on the left,
 * the label (and description) on the right; clicking the text toggles.
 * `boxOffset` nudges the control down onto the first text line
 * (mt-0.75 centres the 14px box on a 20px line).
 */
export function Labelled({ label, description, disabled, className, boxOffset = "mt-0.75", children }: {
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className: string;
  boxOffset?: string;
  children: ReactNode;
}) {
  if (!label) return <span className={`relative inline-flex shrink-0 ${className}`}>{children}</span>;
  return (
    <label className={`inline-flex items-start gap-2 ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"} ${className}`}>
      <span className={`relative inline-flex shrink-0 ${boxOffset}`}>{children}</span>
      <span className="min-w-0 text-sm">
        {label}
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Checkbox({
  label,
  description,
  indeterminate = false,
  className = "",
  ref,
  ...props
}: BaseProps & { indeterminate?: boolean }) {
  const own = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (own.current) own.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <Labelled label={label} description={description} disabled={props.disabled} className={className}>
      <input
        {...props}
        ref={(el) => {
          own.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
        }}
        type="checkbox"
        aria-checked={indeterminate ? "mixed" : undefined}
        className={`${BOX} rounded indeterminate:bg-accent indeterminate:border-accent`}
      />
      <Check
        size={ICON_SIZE.pill}
        strokeWidth={ICON_STROKE.check}
        className="pointer-events-none absolute inset-0 m-auto text-on-accent opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        size={ICON_SIZE.pill}
        strokeWidth={ICON_STROKE.check}
        className="pointer-events-none absolute inset-0 m-auto text-on-accent opacity-0 peer-indeterminate:opacity-100"
      />
    </Labelled>
  );
}

export function Radio({ label, description, className = "", ref, ...props }: BaseProps) {
  return (
    <Labelled label={label} description={description} disabled={props.disabled} className={className}>
      <input {...props} ref={ref} type="radio" className={`${BOX} rounded-full`} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto w-1.5 h-1.5 rounded-full bg-on-accent opacity-0 peer-checked:opacity-100"
      />
    </Labelled>
  );
}
