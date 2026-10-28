import type { ReactNode } from "react";
import { Card } from "./Card";
import { SectionLabel } from "./SectionLabel";

/**
 * Settings building blocks (see DESIGN-SYSTEM.md, "Settings").
 *
 *   <SettingsCard title={t.calendar_sync} desc={t.calendar_permission_help}>
 *     <SettingRow label={t.week_start}><Select … /></SettingRow>
 *     <SettingRow label={t.persona} htmlFor="demo-persona"><Select id="demo-persona" … /></SettingRow>
 *   </SettingsCard>
 */

/** Compact inline row: label left, control right, separated by faint dividers. */
export function SettingRow({
  label,
  desc,
  htmlFor,
  children,
}: {
  label: ReactNode;
  desc?: ReactNode;
  /** Id of the control, so clicking the label focuses it. */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 min-h-9 border-b border-[var(--color-border-divider)] last:border-b-0">
      <div className="flex-1 min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm">
            {label}
          </label>
        ) : (
          <div className="text-sm">{label}</div>
        )}
        {desc && <div className="text-xs text-muted leading-tight mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Topic card: a SectionHeader and its rows inside a bounded surface.
 * Without `title`, the content brings its own header (e.g. a manager with a toolbar).
 */
export function SettingsCard({
  title,
  desc,
  children,
}: {
  title?: string;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card as="section" padding={false} className="border border-[var(--color-border-divider)] px-4 pt-3 pb-1">
      {title && <SectionHeader title={title} desc={desc} />}
      {children}
    </Card>
  );
}

/** Section label with an optional description and a divider under it. */
export function SectionHeader({ title, desc }: { title: string; desc?: ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border-divider)] pb-2 mb-3">
      <SectionLabel as="h2">{title}</SectionLabel>
      {desc && <p className="text-xs text-muted mt-1">{desc}</p>}
    </div>
  );
}
