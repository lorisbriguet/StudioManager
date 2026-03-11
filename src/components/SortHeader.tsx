import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

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
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} px-4 py-2 font-medium text-muted select-none cursor-pointer hover:text-gray-700`}
      onClick={() =>
        onSort({
          key: sortKey,
          dir: active && current.dir === "asc" ? "desc" : "asc",
        })
      }
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          current.dir === "asc" ? (
            <ArrowUp size={12} />
          ) : (
            <ArrowDown size={12} />
          )
        ) : (
          <ArrowUpDown size={12} className="opacity-30" />
        )}
      </span>
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
