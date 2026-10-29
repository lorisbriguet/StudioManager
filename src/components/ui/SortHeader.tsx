import { MUTED_INTERACTIVE, TABLE_TH, TABLE_X } from "./tokens";
import { ICONS, ICON_SIZE } from "./icons";
import { useTableDensity } from "./Table";

export type SortDir = "asc" | "desc";
export type SortState<K extends string = string> = { key: K; dir: SortDir };

export function SortHeader<K extends string>({
  label,
  sortKey,
  current,
  onSort,
  align,
}: {
  label: string;
  sortKey: K;
  current: SortState<K>;
  onSort: (s: SortState<K>) => void;
  align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  const density = useTableDensity();
  return (
    <th
      scope="col"
      aria-sort={active ? (current.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`${TABLE_TH} ${TABLE_X[density]} ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() =>
          onSort({
            key: sortKey,
            dir: active && current.dir === "asc" ? "desc" : "asc",
          })
        }
        className={`focus-accent inline-flex items-center gap-1 rounded font-medium cursor-pointer transition-colors ${MUTED_INTERACTIVE}`}
      >
        {label}
        {active ? (
          current.dir === "asc" ? (
            <ICONS.sortAsc size={ICON_SIZE.control} />
          ) : (
            <ICONS.sortDesc size={ICON_SIZE.control} />
          )
        ) : (
          <ICONS.sortNone size={ICON_SIZE.control} className="opacity-30" />
        )}
      </button>
    </th>
  );
}

export function sortRows<T>(rows: T[], key: string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return dir === "asc" ? av - bv : bv - av;
    const as = String(av).toLowerCase();
    const bs = String(bv).toLowerCase();
    return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
  });
}
