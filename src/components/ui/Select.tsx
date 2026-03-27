import { forwardRef, type CSSProperties, type SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fullWidth?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", fullWidth = true, children, style, ...props }, ref) => {
    const chevronStyle: CSSProperties = {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 0.5rem center",
      ...style,
    };
    return (
      <select
        ref={ref}
        className={`bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm focus-accent appearance-none pr-8 ${
          fullWidth ? "w-full" : ""
        } ${className}`}
        style={chevronStyle}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = "Select";
