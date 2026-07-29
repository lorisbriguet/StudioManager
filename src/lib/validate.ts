/**
 * validate.ts — tiny composable form validation (Phase 2 E1 reference).
 *
 * A Rule takes the raw field value as a string and returns an i18n'd error
 * message (resolved via getLabels() at call time, so it always matches the
 * current app language) or null when the value passes. Every rule except
 * `required` passes empty values — compose with `required` for mandatory
 * fields:
 *
 *   import * as v from "../lib/validate";
 *   const schema: v.FormSchema<"name" | "email" | "due"> = {
 *     name: [v.required],
 *     email: [v.email],               // optional, but must be valid when filled
 *     due: [v.required, v.dateValid], // mandatory AND well-formed
 *   };
 *
 * Form wiring pattern (reference: NewClientForm in pages/ClientsPage.tsx):
 *   - hold `errors` in state: Partial<Record<Field, string>>
 *   - on blur:   validateField(value, schema[field]) -> set/clear that key
 *   - on change: clear that field's error immediately
 *   - on submit: validateForm(form, schema) -> setErrors(result); block
 *     submission when the record is non-empty (fields stay highlighted)
 *
 * Always import as a namespace (`import * as v`) so rule names (email, url)
 * never collide with local identifiers or form field names.
 *
 * NOTE: deliberately named validateForm/validateField — there is an unrelated
 * validateFields() (SQL identifier guard) in src/db/index.ts.
 */
import { getLabels } from "./notifyError";

/** Returns an i18n'd error message, or null when the value is valid. */
export type Rule = (value: string) => string | null;

/** field -> rules, checked in order; the first failing rule's message wins. */
export type FormSchema<F extends string> = Partial<Record<F, Rule[]>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Non-empty after trim. The only rule that fails on empty values. */
export const required: Rule = (value) =>
  value.trim() ? null : getLabels().field_required;

/** Plausible email address (empty passes). */
export const email: Rule = (value) => {
  const s = value.trim();
  return !s || EMAIL_RE.test(s) ? null : getLabels().invalid_email;
};

/** Parseable absolute URL, e.g. https://... (empty passes). */
export const url: Rule = (value) => {
  const s = value.trim();
  if (!s) return null;
  try {
    new URL(s);
    return null;
  } catch {
    return getLabels().invalid_url;
  }
};

/** Finite number strictly greater than zero (empty passes). */
export const numberPositive: Rule = (value) => {
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? null : getLabels().invalid_number;
};

/** At most `max` characters; message interpolates {max}. */
export const maxLen =
  (max: number): Rule =>
  (value) =>
    value.length <= max
      ? null
      : getLabels().max_length_exceeded.replace("{max}", String(max));

/** ISO date (yyyy-mm-dd) that exists on the calendar (empty passes). */
export const dateValid: Rule = (value) => {
  const s = value.trim();
  if (!s) return null;
  const m = ISO_DATE_RE.exec(s);
  if (!m) return getLabels().invalid_date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  const real =
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return real ? null : getLabels().invalid_date;
};

/** Run one field's rules in order; first failure wins. Null when valid. */
export function validateField(value: string, rules: Rule[] | undefined): string | null {
  for (const rule of rules ?? []) {
    const msg = rule(value);
    if (msg) return msg;
  }
  return null;
}

/**
 * Validate every field in the schema against `values` (extra keys in
 * `values` are ignored; non-string values are stringified, null/undefined
 * become ""). Returns a record containing ONLY the failing fields —
 * an empty record means the form is valid.
 */
export function validateForm<F extends string>(
  values: Partial<Record<F, unknown>>,
  schema: FormSchema<F>
): Partial<Record<F, string>> {
  const errors: Partial<Record<F, string>> = {};
  for (const field of Object.keys(schema) as F[]) {
    const raw = values[field];
    const msg = validateField(raw == null ? "" : String(raw), schema[field]);
    if (msg) errors[field] = msg;
  }
  return errors;
}
