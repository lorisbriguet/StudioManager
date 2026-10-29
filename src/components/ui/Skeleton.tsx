/**
 * Skeleton — a grey shimmer the shape of what is loading.
 * See DESIGN-SYSTEM.md, "Empty, loading and error states".
 *
 *   <Skeleton width="40%" />                  one bar
 *   <TableSkeleton columns={5} density="compact" />   (TableSkeleton.tsx) tables
 *   <ListSkeleton rows={5} />                 grouped lists, timelines, widgets, project blocks
 *   <ListSkeleton size="sm" rows={3} />       widgets and side panels (tighter, no leading dot)
 *   <CardGridSkeleton cards={6} />            card grids (Projects)
 *   <DetailSkeleton />                        a record's detail page or peek panel
 */
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  /** Inline placeholder (a span), for use inside text or a button, e.g. a tab label. */
  inline?: boolean;
}

const roundedMap = {
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export function Skeleton({ width, height = 12, rounded = "md", className = "", inline = false }: SkeletonProps) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      aria-hidden={inline || undefined}
      className={`skeleton ${roundedMap[rounded]} ${inline ? "inline-block align-middle" : ""} ${className}`}
      style={{ width, height }}
    />
  );
}

const CYCLE = ["70%", "45%", "60%", "35%", "55%"];

/** Rows of a list: a leading dot, a line, a short trailing value. */
export function ListSkeleton({
  rows = 5,
  size = "md",
  className = "",
}: {
  rows?: number;
  /** md: page lists (32px rows). sm: widgets, blocks and side panels (24px rows, no dot). */
  size?: "sm" | "md";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <div aria-busy="true" className={`flex flex-col ${sm ? "gap-1" : "gap-0"} ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`flex items-center gap-2 ${sm ? "h-6" : "h-8 border-b border-[var(--color-border-divider)]"}`}>
          {!sm && <Skeleton width={12} height={12} rounded="full" />}
          <Skeleton width={CYCLE[i % CYCLE.length]} height={sm ? 10 : 12} />
          <div className="flex-1" />
          <Skeleton width={sm ? 32 : 48} height={sm ? 10 : 12} />
        </div>
      ))}
    </div>
  );
}

/** Cards in the same grid as the Projects page. */
export function CardGridSkeleton({ cards = 6, className = "" }: { cards?: number; className?: string }) {
  return (
    <div aria-busy="true" className={`grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 ${className}`}>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-xl bg-[var(--color-surface)] p-4 flex flex-col gap-3">
          <Skeleton width={CYCLE[i % CYCLE.length]} height={14} />
          <Skeleton width="40%" height={10} />
          <Skeleton height={6} rounded="full" />
          <div className="flex justify-between">
            <Skeleton width={64} height={10} />
            <Skeleton width={8} height={8} rounded="full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A record page: title, meta line, then a few labelled blocks. */
export function DetailSkeleton({ blocks = 3, className = "" }: { blocks?: number; className?: string }) {
  return (
    <div aria-busy="true" className={`flex flex-col gap-6 ${className}`}>
      <div className="flex flex-col gap-2">
        <Skeleton width="35%" height={20} />
        <Skeleton width="20%" height={10} />
      </div>
      {Array.from({ length: blocks }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton width={96} height={10} />
          <Skeleton width="90%" />
          <Skeleton width={CYCLE[i % CYCLE.length]} />
          <Skeleton width="50%" />
        </div>
      ))}
    </div>
  );
}
