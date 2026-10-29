import { useT } from "../../i18n/useT";

/**
 * Spinner — a busy indicator.
 *
 *   <Spinner />                          16px, accent
 *   <Spinner tone="current" size={12} /> takes the text colour (Button's loading state)
 *   <PageSpinner label={t.loading} />    centred in a page
 *
 * role="status", named t.loading unless `label` is given.
 */
interface SpinnerProps {
  size?: number;
  /** accent: on a plain surface. current: inherits the text colour (inside a coloured control). */
  tone?: "accent" | "current";
  /** Accessible name; defaults to t.loading. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 16, tone = "accent", label, className = "" }: SpinnerProps) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={label ?? t.loading}
      className={`inline-block shrink-0 border-2 ${tone === "current" ? "border-current" : "border-accent"} border-t-transparent rounded-full animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center gap-2 text-muted text-sm">
      <Spinner label={label} />
      {label && <span aria-hidden="true">{label}</span>}
    </div>
  );
}
