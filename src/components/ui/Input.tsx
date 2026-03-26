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
        className={`border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent dark:border-gray-600 ${
          fullWidth ? "w-full" : ""
        } ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
