import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import type { LucideIcon } from "lucide-react";
import { ICONS, ICON_SIZE } from "./icons";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";
import { CONTROL_BOX, NUMERIC } from "./tokens";

/**
 * Input / Textarea — text fields. See DESIGN-SYSTEM.md, "Inputs".
 *
 *   <Input value={name} onChange={…} />                       26px, matches Button and the Select trigger
 *   <Input numeric step="0.01" unit="CHF" width="md" />       amounts: right-aligned digits, unit inside
 *   <Input icon={Search} onClear={() => set("")} />           leading icon, trailing clear button
 *   <Input variant="bare" aria-label={col.name} />            table cells: no frame until hover/focus
 *   <Input variant="inline" autoFocus />                      rename in place (prefer InlineRename)
 *   <Textarea value={notes} />                                3 rows, grows to 12, then scrolls
 *   <Textarea variant="composer" rows={1} aria-label={…}      a chat box: framed, buttons inside
 *     leading={attach} trailing={send} attachments={thumbs} />
 */

export type FieldVariant = "default" | "bare" | "inline";
/** Short fields: xs 64px (hours, minutes), sm 96px (rates, %), md 144px (amounts with a unit). */
export type FieldWidth = "xs" | "sm" | "md";

export const FIELD_WIDTH: Record<FieldWidth, string> = { xs: "w-16", sm: "w-24", md: "w-36" };

// Framed variants turn their border red when the field is aria-invalid
// (FormField sets it from `error`; DatePicker sets it on an unparseable date).
// A variant class, so it wins over the resting and `detected` border colours.
const INVALID = "aria-[invalid=true]:border-danger-text";

/** Right-aligned tabular digits, no spinner arrows. */
const NUMERIC_FIELD = `${NUMERIC} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

interface FieldClassOptions {
  variant?: FieldVariant;
  /** Ignored when `width` is set. */
  fullWidth?: boolean;
  width?: FieldWidth;
  /** No fill, dashed border, muted text: a value shown but not editable here. */
  readOnly?: boolean;
  /** Accent border: a value filled in for the user (receipt scan) and not yet touched. */
  detected?: boolean;
  numeric?: boolean;
}

function frame(variant: Exclude<FieldVariant, "inline">, readOnly: boolean, detected: boolean) {
  if (readOnly) {
    return variant === "bare"
      ? "bg-transparent border-transparent text-muted"
      : "bg-transparent border-dashed border-[var(--color-input-border)] text-muted";
  }
  const border = detected ? "border-accent" : variant === "bare" ? "border-transparent" : "border-[var(--color-input-border)]";
  return variant === "bare"
    ? `bg-transparent ${border} hover:border-[var(--color-input-border)] focus:border-[var(--color-input-border)] focus:bg-[var(--color-input-bg)]`
    : `bg-[var(--color-input-bg)] ${border}`;
}

/** Field classes, for the rare control that can't be Input/Textarea. */
export function fieldClass({
  variant = "default",
  fullWidth = true,
  width,
  readOnly = false,
  detected = false,
  numeric = false,
}: FieldClassOptions = {}) {
  const look =
    variant === "inline"
      ? // Font size inherits from the text being renamed; the underline is the cue.
        "bg-transparent border-0 border-b border-accent rounded-none px-0.5 py-0 outline-none focus-accent"
      : // 26px, the shared control box (tokens.ts): lines up with Button and the Select trigger.
        `${CONTROL_BOX} rounded-md focus-accent ${frame(variant, readOnly, detected)} ${INVALID}`;
  const w = width ? FIELD_WIDTH[width] : fullWidth ? "w-full" : "";
  return `${look} placeholder:text-muted disabled:opacity-50 disabled:cursor-not-allowed ${numeric ? NUMERIC_FIELD : ""} ${w}`
    .replace(/\s+/g, " ")
    .trim();
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "width"> {
  /** Full width by default. */
  fullWidth?: boolean;
  /** A fixed short width instead of the full width. */
  width?: FieldWidth;
  variant?: FieldVariant;
  /** Numbers: right-aligned tabular digits, no spinner arrows. Defaults `type` to "number". */
  numeric?: boolean;
  /** A muted suffix inside the box: "CHF", "%", "h". Read out with the field. */
  unit?: string;
  /** A leading icon (search). */
  icon?: LucideIcon;
  /** Shows a trailing clear button while the field has a value. */
  onClear?: () => void;
  /** The clear button's label. Defaults to "Clear". */
  clearLabel?: string;
  /** A trailing control of your own (DatePicker's calendar button). */
  trailing?: ReactNode;
  /** See fieldClass. An error border still wins. */
  detected?: boolean;
  /**
   * With `icon`, `unit`, `onClear` or `trailing` the field sits in a wrapper:
   * `className` then goes on the wrapper (layout) and this on the field itself.
   */
  inputClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      inputClassName = "",
      fullWidth = true,
      width,
      variant = "default",
      numeric = false,
      unit,
      icon: Icon,
      onClear,
      clearLabel,
      trailing,
      detected = false,
      readOnly,
      type,
      style,
      ...props
    },
    ref
  ) => {
    const t = useT();
    const unitId = useId();
    const fieldType = type ?? (numeric ? "number" : undefined);
    const wrapped = !!(Icon || unit || onClear || trailing);
    const cls = fieldClass({ variant, fullWidth, width, readOnly: !!readOnly, detected, numeric });

    if (!wrapped) {
      return (
        <input
          ref={ref}
          type={fieldType}
          readOnly={readOnly}
          style={style}
          className={`${cls} ${className} ${inputClassName}`.trim()}
          {...props}
        />
      );
    }

    const hasValue = props.value !== undefined ? String(props.value) !== "" : true;
    const clear = onClear && hasValue && !props.disabled && !readOnly && (
      <IconButton icon={ICONS.close} label={clearLabel ?? t.clear} size="xs" onClick={onClear} />
    );
    const end = trailing ?? clear;
    // Keep the typed text clear of the unit and the trailing button.
    const padRight = unit
      ? `calc(${end ? "1.75rem" : "0.625rem"} + ${unit.length}ch + 0.375rem)`
      : undefined;
    const describedBy = [props["aria-describedby"], unit ? unitId : undefined].filter(Boolean).join(" ") || undefined;

    return (
      <div
        className={`relative ${width ? FIELD_WIDTH[width] : fullWidth ? "w-full" : "inline-block align-middle"} ${className}`.trim()}
      >
        {Icon && (
          <Icon
            size={ICON_SIZE.control}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
        )}
        <input
          ref={ref}
          type={fieldType}
          readOnly={readOnly}
          style={padRight ? ({ paddingRight: padRight, ...style } as CSSProperties) : style}
          {...props}
          aria-describedby={describedBy}
          className={`${fieldClass({ variant, fullWidth: true, readOnly: !!readOnly, detected, numeric })} ${
            Icon ? "pl-7" : ""
          } ${end && !unit ? "pr-7" : ""} ${inputClassName}`.trim()}
        />
        {unit && (
          <span
            id={unitId}
            className={`absolute top-1/2 -translate-y-1/2 ${end ? "right-7" : "right-2.5"} text-xs text-muted pointer-events-none`}
          >
            {unit}
          </span>
        )}
        {end && <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">{end}</div>}
      </div>
    );
  }
);

Input.displayName = "Input";

/** leading-relaxed, in em, and the vertical padding + border (py-1 + 1px × 2). */
const LINE_EM = 1.625;
const BOX_PX = 10;

function supportsFieldSizing() {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
}

/** `composer`: a message box (Agents) with its buttons inside the frame. */
export type TextareaVariant = Exclude<FieldVariant, "inline"> | "composer";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  fullWidth?: boolean;
  variant?: TextareaVariant;
  /** composer: controls left of the text (attach), bottom-aligned with its first line. */
  leading?: ReactNode;
  /** composer: controls right of the text (send). */
  trailing?: ReactNode;
  /** composer: a wrapping row above the text (attached image thumbnails). */
  attachments?: ReactNode;
  /** composer: accent frame without focus (a file dragged over the window). */
  highlight?: boolean;
  /** composer: `className` goes on the frame, this on the textarea itself. */
  textareaClassName?: string;
  /** The most rows it grows to before it scrolls. */
  maxRows?: number;
  /** Fill the parent's height (the dashboard note): no growing, no resize handle. */
  fill?: boolean;
}

/** The textarea inside a composer frame: no frame of its own, the frame shows focus. */
const COMPOSER_FIELD = `${CONTROL_BOX} flex-1 min-w-0 bg-transparent border-transparent outline-none placeholder:text-muted disabled:opacity-50 disabled:cursor-not-allowed`;

/**
 * `rows` (3) is the starting height. The field grows with its content up to
 * `maxRows` (12), then scrolls: CSS `field-sizing: content` where the engine
 * has it, otherwise the height follows scrollHeight on every render and input.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className = "",
      fullWidth = true,
      variant = "default",
      rows = 3,
      maxRows = 12,
      fill = false,
      leading,
      trailing,
      attachments,
      highlight = false,
      textareaClassName = "",
      style,
      onInput,
      readOnly,
      ...props
    },
    ref
  ) => {
    const inner = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

    const fit = () => {
      const el = inner.current;
      if (!el || fill || supportsFieldSizing()) return;
      el.style.height = "auto";
      // scrollHeight has the padding but not the 1px borders (border-box).
      // min-height / max-height clamp this to rows … maxRows.
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    // Every render: a controlled value may have changed from outside.
    useLayoutEffect(fit);

    const sizing: CSSProperties = fill
      ? {}
      : {
          minHeight: `calc(${rows * LINE_EM}em + ${BOX_PX}px)`,
          maxHeight: `calc(${maxRows * LINE_EM}em + ${BOX_PX}px)`,
        };

    const grow = fill ? "h-full" : "[field-sizing:content] overflow-y-auto";
    const field = (cls: string) => (
      <textarea
        ref={inner}
        rows={rows}
        readOnly={readOnly}
        style={{ ...sizing, ...style }}
        onInput={(e) => {
          fit();
          onInput?.(e);
        }}
        className={`${cls} leading-relaxed resize-none ${grow}`.trim()}
        {...props}
      />
    );

    if (variant !== "composer") {
      return field(`${fieldClass({ variant, fullWidth, readOnly: !!readOnly })} ${className} ${textareaClassName}`);
    }

    return (
      <div
        className={`rounded-xl border bg-[var(--color-input-bg)] p-2 focus-within:border-accent ${
          highlight ? "border-accent" : "border-[var(--color-input-border)]"
        } ${fullWidth ? "w-full" : ""} ${className}`.trim()}
      >
        {attachments && <div className="flex flex-wrap gap-2 px-2 pb-2">{attachments}</div>}
        <div className="flex items-end gap-1.5">
          {/* mb-0.5 centres a 26px button on the first line of text. */}
          {leading && <div className="shrink-0 flex items-center gap-1 mb-0.5">{leading}</div>}
          {field(`${COMPOSER_FIELD} ${textareaClassName}`)}
          {trailing && <div className="shrink-0 flex items-center gap-1 mb-0.5">{trailing}</div>}
        </div>
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
