import { Skeleton } from "./Skeleton";

interface TableSkeletonProps {
  /** Number of columns per row. */
  columns?: number;
  /** Number of skeleton rows. */
  rows?: number;
  /** Optional per-column width hints (e.g. ["40%", "70%"]). Falls back to a cycling 60%/40%/70% pattern. */
  widths?: (string | number)[];
  className?: string;
}

const CYCLE_WIDTHS = ["60%", "40%", "70%"];

export function TableSkeleton({ columns = 4, rows = 8, widths, className = "" }: TableSkeletonProps) {
  return (
    <div aria-busy="true" className={className}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center border-b border-[var(--color-border-divider)]">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="flex-1 px-4 py-2.5">
              <Skeleton width={widths?.[c] ?? CYCLE_WIDTHS[(r + c) % CYCLE_WIDTHS.length]} height={14} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
