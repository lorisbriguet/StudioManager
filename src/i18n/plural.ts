import { useAppStore } from "../stores/app-store";

const RULES = { EN: new Intl.PluralRules("en"), FR: new Intl.PluralRules("fr") } as const;

/**
 * Pick the singular or plural sentence for a count and fill `{count}`:
 *
 *   plural(3, t.confirm_delete_expenses_one, t.confirm_delete_expenses_other) // "Delete 3 expenses?"
 *
 * Follows the UI language's rule: in French 0 takes the singular ("0 tâche"),
 * so a `_one` string must use `{count}`, never a literal 1.
 */
export function plural(count: number, one: string, other: string): string {
  const rule = RULES[useAppStore.getState().language] ?? RULES.EN;
  return (rule.select(count) === "one" ? one : other).replace("{count}", String(count));
}
