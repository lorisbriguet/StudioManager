import { cloneElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * FormField — labeled form control with inline validation (Phase 2 E1).
 *
 * Wraps exactly ONE input-like child (shared <Input>/<Select>, or a raw
 * <input>/<select>/<textarea>) and wires it via cloneElement:
 *   - `id`               the child's own id when it has one, else generated
 *                        with useId; targeted by the visible <label htmlFor>
 *   - `aria-required`    "true" when `required` is set
 *   - `aria-invalid`     "true" when `error` is set
 *   - `aria-describedby` points at the error line when `error` is set
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
 * Not for checkboxes/toggles — those keep their inline-label pattern.
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
}

export function FormField({ label, children, error, required = false, className = "", badge }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = children.props.id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const control = cloneElement(children, {
    id: fieldId,
    "aria-required": required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    className: `${children.props.className ?? ""} aria-[invalid=true]:border-danger-text`.trim(),
  });
  const labelEl = (
    <label htmlFor={fieldId} className={`block text-xs text-muted ${badge ? "" : "mb-1"}`}>
      {label}
      {required && <span aria-hidden="true" className="text-accent ml-0.5">*</span>}
    </label>
  );
  return (
    <div className={className}>
      {badge ? (
        <div className="flex items-center justify-between mb-1">
          {labelEl}
          {badge}
        </div>
      ) : (
        labelEl
      )}
      {control}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
