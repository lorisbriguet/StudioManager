import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

/**
 * Input / Textarea — text fields. See DESIGN-SYSTEM.md, "Inputs".
 *
 *   <Input value={name} onChange={…} />                       default sm: matches the thin Select trigger
 *   <Input size="md" />                                       opt-in larger field (rare)
 *   <Input variant="bare" size="sm" />                        table cells: no frame until hover/focus
 *   <Input variant="inline" autoFocus />                      rename in place: accent underline only
 *   <Textarea rows={4} />
 */

export type FieldSize = "sm" | "md";
export type FieldVariant = "default" | "bare" | "inline";

const SIZE: Record<FieldSize, string> = {
  md: "px-3 py-2 text-sm rounded-lg",
  sm: "px-2.5 py-1 text-xs rounded-md",
};

const VARIANT: Record<FieldVariant, string> = {
  default: "bg-[var(--color-input-bg)] border border-[var(--color-input-border)] focus-accent",
  bare: "bg-transparent border border-transparent hover:border-[var(--color-input-border)] focus:border-[var(--color-input-border)] focus:bg-[var(--color-input-bg)] focus-accent",
  // Font size inherits from the text being renamed; the underline is the focus cue.
  inline: "bg-transparent border-0 border-b border-accent rounded-none px-0.5 py-0 outline-none",
};

/** Field classes, for the rare control that can't be Input/Textarea. */
export function fieldClass({
  size = "sm",
  variant = "default",
  fullWidth = true,
}: { size?: FieldSize; variant?: FieldVariant; fullWidth?: boolean } = {}) {
  return `${VARIANT[variant]} ${variant === "inline" ? "" : SIZE[size]} placeholder:text-muted disabled:opacity-50 disabled:cursor-not-allowed ${
    fullWidth ? "w-full" : ""
  }`;
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Full width by default */
  fullWidth?: boolean;
  size?: FieldSize;
  variant?: FieldVariant;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", fullWidth = true, size = "sm", variant = "default", ...props }, ref) => {
    return <input ref={ref} className={`${fieldClass({ size, variant, fullWidth })} ${className}`} {...props} />;
  }
);

Input.displayName = "Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  fullWidth?: boolean;
  size?: FieldSize;
  variant?: Exclude<FieldVariant, "inline">;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", fullWidth = true, size = "sm", variant = "default", rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`${fieldClass({ size, variant, fullWidth })} resize-y leading-relaxed ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
