/**
 * Thin horizontal meter (track `--color-input-bg`, rounded fill). Shared by
 * the consumables stock bar and the drive age bar.
 */
export function MeterBar({ pct, color, className = "w-[120px]", label }: {
  /** 0–100; clamped. */
  pct: number;
  /** A colour token, e.g. `var(--color-success-text)`. */
  color: string;
  className?: string;
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
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}
