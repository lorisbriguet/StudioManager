import type { HTMLAttributes, ReactNode, Ref } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** Block surface. Other div props (onContextMenu, style, ref, aria-*) pass through. */
export function Card({ children, className = "", padding = true, ...props }: CardProps) {
  return (
    <div {...props} className={`rounded-xl bg-[var(--color-surface)] ${padding ? "p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}
