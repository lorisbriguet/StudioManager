/**
 * Escape `%`, `_` and `\` so `text` matches literally inside a LIKE pattern.
 * The query must declare the escape character: `LIKE $n ESCAPE '\'`.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => "\\" + c);
}
