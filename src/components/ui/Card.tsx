import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className = "", padding = true }: CardProps) {
  return (
    <div className={`rounded-xl bg-[var(--color-surface)] ${padding ? "p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}
