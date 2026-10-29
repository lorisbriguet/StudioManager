import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { FIELD_LABEL, FORM_SPAN, type FormSpan } from "./tokens";

/**
 * FormField — labeled form control with inline validation (Phase 2 E1).
 *
 * Wraps exactly ONE input-like child (shared <Input>/<Select>, or a raw
 * <input>/<select>/<textarea>) and wires it via cloneElement:
 *   - `id`               the child's own id when it has one, else generated
 *                        with useId; targeted by the visible <label htmlFor>
 *   - `aria-required`    "true" when `required` is set
 *   - `aria-invalid`     "true" when `error` is set
 *   - `aria-describedby` the child's own ids, then the hint, then the error
 *                        line (merged, never replaced)
 *   - danger border      appends `aria-[invalid=true]:border-danger-text` to the
 *                        child's className, so the border turns to the danger
 *                        token exactly while the field is in error
 *
 * The child keeps all of its own props (value/onChange/onBlur/placeholder...).
 * Pass `error` straight from the form's `errors` record (see lib/validate.ts
 * for the schema + blur/change/submit wiring pattern); when falsy, only the
 * label and control render. `required` shows a persistent accent asterisk
 * (aria-hidden; screen readers get aria-required instead) — purely visual,
 * the actual rule lives in the form's validate schema.
 *
 *   <FormField label={t.display_name} required error={errors.name}>
 *     <Input value={form.name} onChange={...} onBlur={...} />
 *   </FormField>
 *
 * `hint` is a muted line under the field. The error takes its place on screen
 * while there is one; the hint stays in the DOM (sr-only) and stays linked.
 * `span` makes the field take 2–4 columns, or the whole row, of a FormGrid.
 *
 * Not for checkboxes/toggles — give those their own `label`.
 *
 * Test authors: on a required field the label's text content is "Name*", so
 * getByLabelText("Name") (exact match) fails — and aria-hidden does not fix
 * testing-library's label matching. Query with a regex
 * (getByLabelText(/^Name/)) or getByRole("textbox", { name: "Name" }).
 */

interface InputLikeProps {
  id?: string;
  className?: string;
  "aria-required"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}

interface FormFieldProps {
  label: string;
  children: ReactElement<InputLikeProps>;
  error?: string;
  required?: boolean;
  className?: string;
  /** Optional chip rendered right-aligned on the label row (e.g. DetectedBadge). */
  badge?: ReactNode;
  /** Help under the field. */
  hint?: ReactNode;
  /** Columns taken in a FormGrid. */
  span?: FormSpan;
}

export function FormField({ label, children, error, required = false, className = "", badge, hint, span }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = children.props.id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  // The child's own description first, then the hint, then the error: none replaces another.
  const describedBy =
    [children.props["aria-describedby"], hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") ||
    undefined;
  const control = cloneElement(children, {
    id: fieldId,
    "aria-required": required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: `${children.props.className ?? ""} aria-[invalid=true]:border-danger-text`.trim(),
  });
  const labelEl = (
    <label htmlFor={fieldId} className={`${FIELD_LABEL} ${badge ? "" : "mb-1"}`}>
      {label}
      {required && <span aria-hidden="true" className="text-accent-text ml-0.5">*</span>}
    </label>
  );
  return (
    <div className={`${span ? FORM_SPAN[span] : ""} ${className}`.trim() || undefined}>
      {badge ? (
        <div className="flex items-center justify-between mb-1">
          {labelEl}
          {badge}
        </div>
      ) : (
        labelEl
      )}
      {control}
      {hint && (
        // While there is an error the hint is only read out (the error takes its place on screen).
        <p id={hintId} className={error ? "sr-only" : "mt-1 text-xs text-muted"}>
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * The red error line under a field, announced to screen readers. FormField
 * draws it; use it alone for an error without a visible label (a row rename,
 * the line-items check). Link it from the field with aria-describedby.
 */
export function FieldError({ id, className = "", children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className={`mt-1 text-xs text-danger-text ${className}`}>
      {children}
    </p>
  );
}
