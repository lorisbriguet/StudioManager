import { Skeleton } from "./Skeleton";
import { TABLE_ROW_H, TABLE_X, type TableDensity } from "./tokens";

interface TableSkeletonProps {
  /** Number of columns per row. */
  columns?: number;
  /** Number of skeleton rows. */
  rows?: number;
  /** Optional per-column width hints (e.g. ["40%", "70%"]). Falls back to a cycling 60%/40%/70% pattern. */
  widths?: (string | number)[];
  /** Same density as the Table it stands in for, so nothing jumps when data arrives. */
  density?: TableDensity;
  className?: string;
}

const CYCLE_WIDTHS = ["60%", "40%", "70%"];

export function TableSkeleton({ columns = 4, rows = 8, widths, density = "default", className = "" }: TableSkeletonProps) {
  return (
    <div aria-busy="true" className={className}>
      <div className="h-8 border-b border-[var(--color-border-header)]" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={`flex items-center border-b border-[var(--color-border-divider)] ${TABLE_ROW_H[density]}`}>
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className={`flex-1 ${TABLE_X[density]}`}>
              <Skeleton width={widths?.[c] ?? CYCLE_WIDTHS[(r + c) % CYCLE_WIDTHS.length]} height={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
