import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import type { PanelTitleProps } from "../ui/PanelTitle";

/**
 * The content of a list/chart dashboard widget and its title. The frame is a
 * Card (padding none) in DashboardPage; WidgetShell is the card's 16px content.
 *
 *   <WidgetShell>
 *     <WidgetTitle tone="warning">{t.stale_tasks}</WidgetTitle>
 *     …
 *   </WidgetShell>
 */
export function WidgetShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`h-full flex flex-col p-4 ${className}`}>{children}</div>;
}

/** The widget's Card.Header (level-2 title, 12px below). */
export function WidgetTitle({
  children,
  tone = "default",
  action,
}: {
  children: ReactNode;
  /** danger / warning use the dark-mode aware text colours. */
  tone?: PanelTitleProps["tone"];
  /** Right-aligned control next to the title (e.g. a "View all" link). */
  action?: ReactNode;
}) {
  return <Card.Header title={children} tone={tone} action={action} />;
}
