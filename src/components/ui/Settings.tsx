import { cloneElement, Fragment, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Card } from "./Card";
import { Button } from "./Button";

/**
 * Settings building blocks (see DESIGN-SYSTEM.md, "Settings").
 *
 *   <SettingsCard title={t.calendar_sync} desc={t.calendar_permission_help}>
 *     <SettingRow label={t.week_start}><Select … /></SettingRow>
 *     <SettingRow label={t.persona} htmlFor="demo-persona"><Select id="demo-persona" … /></SettingRow>
 *   </SettingsCard>
 */

const LABELABLE_TAGS = new Set(["input", "select", "textarea"]);

/** A single control the row's label can point at: a field component, a Toggle, a native field. Not a wrapper div or a Button. */
function isLabelable(node: ReactNode): node is ReactElement<{ id?: string }> {
  if (!isValidElement(node)) return false;
  if (typeof node.type === "string") return LABELABLE_TAGS.has(node.type);
  return node.type !== Fragment && node.type !== Button;
}

/**
 * Compact inline row: label left, control right, separated by faint dividers.
 * Like FormField: a single control child gets an id (its own, or generated) and
 * the label is a <label htmlFor> pointing at it. When the child is a wrapper
 * (a div with a select and a hint), pass `htmlFor` with the control's id, or
 * give the control its own aria-label.
 */
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
  const generatedId = useId();
  let control = children;
  let target = htmlFor;
  if (!target && isLabelable(children)) {
    target = children.props.id ?? generatedId;
    control = cloneElement(children, { id: target });
  }
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 min-h-9 border-b border-[var(--color-border-divider)] last:border-b-0">
      <div className="flex-1 min-w-0">
        {target ? (
          <label htmlFor={target} className="block text-sm">
            {label}
          </label>
        ) : (
          <div className="text-sm">{label}</div>
        )}
        {desc && <div className="text-xs text-muted leading-tight mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{control}</div>
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
    <Card as="section" tone="inset" padding="none" className="px-4 pt-3 pb-1">
      {title && <SectionHeader title={title} desc={desc} />}
      {children}
    </Card>
  );
}

/** Section label with an optional description and a divider under it: Card.Header variant="label" divider. */
export function SectionHeader({ title, desc }: { title: string; desc?: ReactNode }) {
  return <Card.Header title={title} subtitle={desc} variant="label" divider />;
}
