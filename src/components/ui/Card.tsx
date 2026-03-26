import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className = "", padding = true }: CardProps) {
  return (
    <div className={`border border-gray-100 rounded-lg bg-white dark:bg-gray-100 ${padding ? "p-4" : ""} ${className}`}>
      {children}
    </div>
  );
}
