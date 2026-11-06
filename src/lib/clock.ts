/**
 * Time and id helpers for event handlers. Render must stay pure (no Date.now() there:
 * use the useNow hook); a handler that needs the time or a fresh id calls these.
 */

/** The current time in ms. */
export function nowMs(): number {
  return Date.now();
}

/** A new id made of a prefix and the current time, such as `col_1730900000000`. */
export function newId(prefix: string): string {
  return `${prefix}${Date.now()}`;
}
