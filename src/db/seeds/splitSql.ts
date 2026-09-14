/**
 * Split a seed SQL file into executable statements.
 *
 * Comment-only lines are dropped first, then the remaining text is cut on
 * semicolons that sit outside single-quoted string literals. Kept free of
 * Tauri imports so tests can validate seed files statically.
 */
export function splitSeedStatements(sql: string): string[] {
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const statements: string[] = [];
  let buf = "";
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      buf += ch;
      if (ch === "'") {
        // An escaped quote ('') stays inside the string
        if (body[i + 1] === "'") {
          buf += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      buf += ch;
    } else if (ch === ";") {
      const stmt = buf.trim();
      if (stmt.length > 0) statements.push(stmt);
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}
