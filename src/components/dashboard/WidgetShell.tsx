import type { ReactNode } from "react";
import { PanelTitle, type PanelTitleProps } from "../ui/PanelTitle";

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

/** A PanelTitle (h2, text-sm medium) with the widget's bottom margin. */
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
  return <PanelTitle title={children} tone={tone} action={action} className="mb-3" />;
}
