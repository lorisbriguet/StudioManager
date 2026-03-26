import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ message, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted">
      {icon && <div className="mb-2 opacity-40">{icon}</div>}
      <div className="text-sm">{message}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
