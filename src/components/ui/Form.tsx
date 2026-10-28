import type { ElementType, FormEvent, HTMLAttributes, ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";
import { FORM_ACTIONS, FORM_GAP, FORM_STACK, FORM_WIDTH } from "./tokens";

/**
 * Form layout. See DESIGN-SYSTEM.md, "Forms".
 *
 *   <FormLayout as="form" onSubmit={submit}>
 *     <FormSection title={t.client}>
 *       <FormGrid cols={2}>
 *         <FormField label={t.client} required>…</FormField>
 *         <FormField label={t.address} span="full" hint={…}>…</FormField>
 *       </FormGrid>
 *     </FormSection>
 *     <FormActions destructive={<Button variant="danger">…</Button>}>
 *       <Button variant="secondary">{t.cancel}</Button>
 *       <Button type="submit">{t.create}</Button>
 *     </FormActions>
 *   </FormLayout>
 *
 * In a Modal, the FormGrid goes in the body and the buttons in `footer`,
 * which is the same right-aligned row.
 */

interface FormLayoutProps extends Omit<HTMLAttributes<HTMLElement>, "onSubmit"> {
  as?: ElementType;
  /** Cap at 768px (page forms). Turn off inside modals, popovers and side panels. */
  capped?: boolean;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

/** Sections and the action row, 24px apart. */
export function FormLayout({ as: Tag = "div", capped = true, className = "", children, ...rest }: FormLayoutProps) {
  return (
    <Tag className={`${FORM_STACK} ${capped ? FORM_WIDTH : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

const COLS = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;

/** Fields in 1–4 equal columns, 12px apart both ways. A FormField can `span`. */
export function FormGrid({ cols = 2, className = "", children }: { cols?: 1 | 2 | 3 | 4; className?: string; children: ReactNode }) {
  return <div className={`grid ${COLS[cols]} ${FORM_GAP} ${className}`}>{children}</div>;
}

/** A titled group of fields: SectionLabel, 12px, then the fields. */
export function FormSection({ title, action, className = "", children }: { title: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={className}>
      <SectionLabel as="h2" action={action} className="mb-3">
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

/**
 * The action row: right-aligned, primary last. `destructive` (Delete) sits on
 * the far left. Order the children: Cancel (secondary), other actions, primary.
 */
export function FormActions({ destructive, className = "", children }: { destructive?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`${FORM_ACTIONS} ${className}`}>
      {destructive && <div className="mr-auto flex items-center gap-2">{destructive}</div>}
      {children}
    </div>
  );
}
