import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { AlertTriangle, CheckCircle2, GripVertical, Info, XCircle } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Button } from "./Button";

/**
 * Small building blocks: ProgressBar, Callout, ConfirmButton, DragHandle.
 * See DESIGN-SYSTEM.md, "Feedback".
 */

// ─── ProgressBar ────────────────────────────────────────────────────────

type Tone = "accent" | "success" | "warning" | "danger";
const FILL: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-[var(--color-success-text)]",
  warning: "bg-[var(--color-warning-text)]",
  danger: "bg-[var(--color-danger-text)]",
};

/**
 *   <ProgressBar value={62} label={t.progress} showValue />
 */
export function ProgressBar({
  value,
  label,
  showValue = false,
  tone = "accent",
  size = "sm",
  className = "",
}: {
  /** 0–100 */
  value: number;
  label?: ReactNode;
  showValue?: boolean;
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>{label}</span>
          {showValue && <span className="tabular-nums">{v}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === "string" ? label : undefined}
        className={`${size === "sm" ? "h-1.5" : "h-2"} w-full rounded-full bg-[var(--color-input-bg)] overflow-hidden`}
      >
        <div className={`h-full rounded-full transition-all ${FILL[tone]}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

// ─── Callout ────────────────────────────────────────────────────────────

const CALLOUT = {
  warning: { cls: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]", Icon: AlertTriangle },
  info: { cls: "bg-[var(--color-info-bg)] text-[var(--color-info-text)]", Icon: Info },
  danger: { cls: "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]", Icon: XCircle },
  success: { cls: "bg-[var(--color-success-bg)] text-[var(--color-success-text)]", Icon: CheckCircle2 },
};

/**
 *   <Callout tone="warning" action={<Button size="sm" …>{t.fix}</Button>}>{t.receipts_missing_category}</Callout>
 */
export function Callout({
  tone = "info",
  children,
  action,
  className = "",
}: {
  tone?: keyof typeof CALLOUT;
  children: ReactNode;
  /** Right-aligned control (a button, a link). */
  action?: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = CALLOUT[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm ${cls} ${className}`}>
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── ConfirmButton ──────────────────────────────────────────────────────

/**
 * A destructive action that asks in place before running.
 *
 *   <ConfirmButton label={t.delete} question={t.confirm_delete_client} onConfirm={remove} />
 *
 * First click swaps the button for "question + Delete + Cancel". Esc or a
 * click elsewhere cancels.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  icon,
  variant = "danger",
  size = "sm",
  disabled,
}: {
  label: ReactNode;
  question: ReactNode;
  /** Defaults to `label`. */
  confirmLabel?: ReactNode;
  onConfirm: () => void;
  icon?: ReactNode;
  variant?: "danger" | "danger-outline" | "ghost" | "secondary";
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asking) return;
    confirmRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setAsking(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [asking]);

  if (!asking) {
    return (
      <Button variant={variant} size={size} icon={icon} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div
      ref={box}
      role="group"
      className="inline-flex items-center gap-2 text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setAsking(false);
        }
      }}
    >
      <span className="text-[var(--color-danger-text)]">{question}</span>
      <Button
        ref={confirmRef}
        variant="danger"
        size={size}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? label}
      </Button>
      <Button variant="secondary" size={size} onClick={() => setAsking(false)}>
        {t.cancel}
      </Button>
    </div>
  );
}

// ─── DragHandle ─────────────────────────────────────────────────────────

/**
 * The grip for reordering with dnd-kit. Spread `attributes` and `listeners` on it.
 *
 *   <DragHandle {...attributes} {...listeners} reveal />
 */
export function DragHandle({
  reveal = false,
  size = 14,
  className = "",
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** Only on hover of a `group` ancestor (or keyboard focus). */
  reveal?: boolean;
  size?: 12 | 14;
  ref?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  return (
    <div
      ref={ref}
      aria-label={t.drag_to_reorder}
      {...props}
      className={`cursor-grab active:cursor-grabbing touch-none shrink-0 text-muted hover:text-[var(--color-text-secondary)] rounded focus-accent transition-opacity ${
        reveal ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""
      } ${className}`}
    >
      <GripVertical size={size} aria-hidden="true" />
    </div>
  );
}
