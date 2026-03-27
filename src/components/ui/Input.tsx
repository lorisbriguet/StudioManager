import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Full width by default */
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", fullWidth = true, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm focus-accent ${
          fullWidth ? "w-full" : ""
        } ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
