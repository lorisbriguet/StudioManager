import type { ReactNode } from "react";

/**
 * The frame every list/chart dashboard widget sits in, and its title.
 *
 *   <WidgetShell>
 *     <WidgetTitle tone="warning">{t.stale_tasks}</WidgetTitle>
 *     …
 *   </WidgetShell>
 */
export function WidgetShell({ children }: { children: ReactNode }) {
  return <div className="h-full flex flex-col p-4">{children}</div>;
}

const TONE = {
  default: "",
  danger: "text-danger",
  warning: "text-warning",
};

export function WidgetTitle({
  children,
  tone = "default",
  action,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  /** Right-aligned control next to the title (e.g. a "View all" link). */
  action?: ReactNode;
}) {
  if (!action) return <h2 className={`text-sm font-medium mb-3 ${TONE[tone]}`}>{children}</h2>;
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className={`text-sm font-medium ${TONE[tone]}`}>{children}</h2>
      {action}
    </div>
  );
}
