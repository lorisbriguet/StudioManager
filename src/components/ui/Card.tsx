import type { HTMLAttributes, ReactNode, Ref } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  /** The element: `section` / `article` when the card is a landmark of the page. */
  as?: "div" | "section" | "article";
  ref?: Ref<HTMLDivElement>;
}

/** Block surface. Other div props (onContextMenu, style, ref, aria-*) pass through. */
export function Card({ children, className = "", padding = true, as = "div", ...props }: CardProps) {
  // Typed as "div" so the HTMLDivElement props and ref type-check; section and article take the same ones.
  const Tag = as as "div";
  return (
    <Tag {...props} className={`rounded-xl bg-[var(--color-surface)] ${padding ? "p-5" : ""} ${className}`}>
      {children}
    </Tag>
  );
}
