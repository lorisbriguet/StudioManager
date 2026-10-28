/**
 * Thin horizontal meter: `--color-input-bg` track, rounded fill. Used for
 * progress, shares, stock levels and drive age.
 */
export function MeterBar({ pct, color, className = "w-full", label }: {
  /** 0–100; clamped. */
  pct: number;
  /** A colour token or value, e.g. `var(--color-success-text)`. */
  color: string;
  /** Width and spacing of the track (default `w-full`). */
  className?: string;
  /** Accessible name; when set the bar is exposed as a `meter`. */
  label?: string;
}) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div
      className={`h-1.5 rounded-full bg-[var(--color-input-bg)] overflow-hidden ${className}`}
      role={label ? "meter" : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(width) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}
