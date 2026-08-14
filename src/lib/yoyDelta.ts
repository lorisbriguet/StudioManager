/**
 * Rounded year-over-year percent change, or null when the previous year has
 * no value to compare against. Uses |previous| as the base so deltas stay
 * meaningful when the previous value is negative (e.g. net result).
 */
export function yoyDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
