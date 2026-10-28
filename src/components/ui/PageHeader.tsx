import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  children?: ReactNode;
  /** Spacing around the header; `mb-6` (after the page header) by default. */
  className?: string;
}

export function PageHeader({ title, children, className = "mb-6" }: PageHeaderProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
