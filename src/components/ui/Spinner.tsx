interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 16, className = "" }: SpinnerProps) {
  return (
    <div
      className={`border-2 border-accent border-t-transparent rounded-full animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center gap-2 text-muted text-sm">
      <Spinner />
      {label && <span>{label}</span>}
    </div>
  );
}
