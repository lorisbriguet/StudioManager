import { getDb } from "../index";
import { escapeLike } from "./escapeLike";

const SAFE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Generate the next sequential reference for any entity table.
 * Pattern: prefix + zero-padded number (e.g., "2026-001", "D-2026-001", "F-26-001")
 */
export async function getNextReference(
  table: string,
  column: string,
  prefix: string,
  padLength: number = 3
): Promise<string> {
  if (!SAFE_NAME.test(table) || !SAFE_NAME.test(column)) {
    throw new Error("Invalid table or column name");
  }
  const db = await getDb();
  const rows = await db.select<{ max_num: number | null }[]>(
    `SELECT MAX(CAST(SUBSTR(${column}, $1) AS INTEGER)) as max_num FROM ${table} WHERE ${column} LIKE $2 ESCAPE '\\'`,
    [prefix.length + 1, `${escapeLike(prefix)}%`]
  );
  const next = (rows[0]?.max_num ?? 0) + 1;
  return `${prefix}${String(next).padStart(padLength, "0")}`;
}

/**
 * The year a reference is numbered in: the year of the record's own date
 * (YYYY-MM-DD), or this year when it has none.
 */
export function referenceYear(date: string | null | undefined): number {
  const year = /^(\d{4})-\d{2}-\d{2}/.exec(date ?? "")?.[1];
  return year ? Number(year) : new Date().getFullYear();
}
