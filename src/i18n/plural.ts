/**
 * Pick the singular or plural sentence for a count and fill `{count}`:
 *
 *   plural(3, t.confirm_delete_expenses_one, t.confirm_delete_expenses_other) // "Delete 3 expenses?"
 */
export function plural(count: number, one: string, other: string): string {
  return (count === 1 ? one : other).replace("{count}", String(count));
}
