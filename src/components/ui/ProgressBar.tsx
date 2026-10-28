const FILL = {
  accent: "bg-accent",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
} as const;

/** A thin progress track (1.5 tall) with a filled share. `value` is 0-100 and is clamped. */
export function ProgressBar({
  value,
  tone = "accent",
  label,
}: {
  value: number;
  tone?: keyof typeof FILL;
  /** Accessible name when the surrounding text does not name the bar. */
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className="h-1.5 bg-[var(--color-input-bg)] rounded-full overflow-hidden"
    >
      <div data-fill className={`h-full rounded-full transition-all ${FILL[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
