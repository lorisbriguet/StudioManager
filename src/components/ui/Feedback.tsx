import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { ICONS, ICON_SIZE, type IconProp } from "./icons";
import { useT } from "../../i18n/useT";
import { Button } from "./Button";
import { variantClasses } from "./Badge";
import { revealClass, type RevealGroup } from "./IconButton";
import { MUTED_INTERACTIVE } from "./tokens";

/**
 * Small building blocks: ProgressBar, Callout, ConfirmButton, DragHandle.
 * See DESIGN-SYSTEM.md, "Feedback".
 */

// ─── ProgressBar ────────────────────────────────────────────────────────

type Tone = "accent" | "success" | "warning" | "danger";
/** The fill is the tone's text colour (the same variables as Badge / Callout's text). */
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

/** Colours are Badge's: a warning callout and a warning badge are the same tone. */
const CALLOUT = {
  warning: { cls: variantClasses.warning, Icon: ICONS.warning },
  info: { cls: variantClasses.info, Icon: ICONS.info },
  danger: { cls: variantClasses.danger, Icon: ICONS.danger },
  success: { cls: variantClasses.success, Icon: ICONS.success },
};

/**
 *   <Callout tone="warning" action={<Button …>{t.fix}</Button>}>{t.receipts_missing_category}</Callout>
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
      <Icon size={ICON_SIZE.callout} className="shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
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
  disabled,
}: {
  label: ReactNode;
  question: ReactNode;
  /** Defaults to `label`. */
  confirmLabel?: ReactNode;
  onConfirm: () => void;
  /** A lucide component (Button draws it at 12px) or an element. */
  icon?: IconProp;
  variant?: "danger" | "outline" | "secondary";
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
      <Button variant={variant} icon={icon} disabled={disabled} onClick={() => setAsking(true)}>
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
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? label}
      </Button>
      <Button variant="secondary" onClick={() => setAsking(false)}>
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
  size = ICON_SIZE.menu,
  className = "",
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** Only on hover of the row (or keyboard focus): `true` = nearest `group`, or a named group, as IconButton. */
  reveal?: RevealGroup | false;
  size?: 12 | 14;
  ref?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  return (
    <div
      ref={ref}
      aria-label={t.drag_to_reorder}
      {...props}
      className={`cursor-grab active:cursor-grabbing touch-none shrink-0 ${MUTED_INTERACTIVE} rounded focus-accent transition-opacity ${revealClass(
        reveal
      )} ${className}`}
    >
      <ICONS.drag size={size} />
    </div>
  );
}
