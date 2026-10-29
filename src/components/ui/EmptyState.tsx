import type { ReactNode } from "react";
import { ICON_SIZE, renderIcon, type IconProp } from "./icons";

/**
 * EmptyState — what a surface shows when it has nothing to show.
 * See DESIGN-SYSTEM.md, "Empty, loading and error states".
 *
 *   <EmptyState icon={FolderOpen} message={t.no_projects} action={<Button …>{t.new_project}</Button>} />
 *   <EmptyState size="sm" message={t.nothing_overdue} />        widgets, blocks, side panels, popovers
 *   <EmptyState tone="danger" icon={ICONS.warning} message={t.page_error_title} action={retry} />
 *
 * lg (default, pages): 32px icon, text-sm message, optional hint, py-12.
 * sm (widgets, project/client blocks, side panels, popovers): 20px icon, text-xs, py-4.
 *
 * `icon` takes a Lucide component (sized for you) or an element (kept as is).
 */
export type EmptyStateSize = "lg" | "sm";

interface EmptyStateProps {
  message: ReactNode;
  /** A second, quieter line: what to do, or why it's empty. */
  hint?: ReactNode;
  icon?: IconProp;
  action?: ReactNode;
  size?: EmptyStateSize;
  /** danger: an error state (icon in the danger colour), announced as role="alert". */
  tone?: "default" | "danger";
  className?: string;
}

const SIZE = {
  lg: { box: "py-12", icon: ICON_SIZE.empty, message: "text-sm", hint: "text-xs mt-1", action: "mt-3", iconGap: "mb-2" },
  sm: { box: "py-4", icon: ICON_SIZE.emptySm, message: "text-xs", hint: "text-xs mt-0.5", action: "mt-2", iconGap: "mb-1.5" },
};

export function EmptyState({ message, hint, icon, action, size = "lg", tone = "default", className = "" }: EmptyStateProps) {
  const s = SIZE[size];
  const iconNode = renderIcon(icon, s.icon);
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`flex flex-col items-center justify-center text-center text-muted ${s.box} ${className}`}
    >
      {iconNode && (
        <div aria-hidden="true" className={`${s.iconGap} ${tone === "danger" ? "text-[var(--color-danger-text)]" : "opacity-40"}`}>{iconNode}</div>
      )}
      <div className={`${s.message} ${tone === "danger" ? "text-[var(--color-text)]" : ""}`}>{message}</div>
      {hint && <div className={`${s.hint} max-w-sm opacity-80`}>{hint}</div>}
      {action && <div className={`${s.action} flex items-center gap-2`}>{action}</div>}
    </div>
  );
}
