import { useId, type ElementType, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import { useT } from "../../i18n/useT";
import { Button } from "./Button";
import { Modal, type ModalSize } from "./Modal";
import { SectionLabel } from "./SectionLabel";
import { FIELD_LABEL, FORM_ACTIONS, FORM_GAP, FORM_SPAN, FORM_STACK, FORM_WIDTH, type FormSpan } from "./tokens";

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
  /** 12px between blocks instead of 24px: small editor cards (a contact, an address). */
  dense?: boolean;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

/** Sections and the action row, 24px apart (12px when dense). */
export function FormLayout({ as: Tag = "div", capped = true, dense = false, className = "", children, ...rest }: FormLayoutProps) {
  return (
    <Tag className={`${dense ? `flex flex-col ${FORM_GAP}` : FORM_STACK} ${capped ? FORM_WIDTH : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

const COLS = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;

/** Fields in 1–4 equal columns, 12px apart both ways. A FormField can `span`. */
export function FormGrid({ cols = 2, className = "", children }: { cols?: 1 | 2 | 3 | 4; className?: string; children: ReactNode }) {
  return <div className={`grid ${COLS[cols]} ${FORM_GAP} ${className}`}>{children}</div>;
}

/** Anything other than a FormField in a FormGrid that should span columns (a checkbox row, a note). */
export function FormGridItem({ span = "full", className = "", children }: { span?: FormSpan; className?: string; children: ReactNode }) {
  return <div className={`${FORM_SPAN[span]} ${className}`}>{children}</div>;
}

/**
 * A label over several controls (a colour picker and its hex field, a list of
 * checkboxes, an options editor), announced as a group. `action` sits at the
 * right of the label row (import from list, unlink).
 */
export function FormGroup({ label, action, span, className = "", children }: { label: ReactNode; action?: ReactNode; span?: FormSpan; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={`${span ? FORM_SPAN[span] : ""} ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span id={id} className={FIELD_LABEL}>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
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

interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Runs on the primary button and on Enter in a field. */
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  /** Shows the spinner on the primary button. */
  submitting?: boolean;
  /** Actions between Cancel and the primary (e.g. "Save and preview"). */
  extraActions?: ReactNode;
  /** Far-left action (Delete). */
  destructive?: ReactNode;
  /** md (560px, the default): record forms and editors. sm (400px): one to three fields. */
  size?: Exclude<ModalSize, "full">;
  children: ReactNode;
}

/**
 * Every dialog with fields: creating a client, an expense, a project, a
 * one-field prompt… The body is a <form>, so Enter in a field submits; the
 * footer is Cancel (secondary), any extra actions, then the primary. Give the
 * first field `autoFocus`; pass `submitting` while it saves.
 *
 *   <FormModal open title={t.new_client} submitLabel={t.save} onSubmit={save} onClose={close}>
 *     <FormGrid cols={2}>…</FormGrid>
 *   </FormModal>
 */
export function FormModal({
  open, onClose, title, onSubmit, submitLabel, submitDisabled, submitting, extraActions, destructive, size = "md", children,
}: FormModalProps) {
  const t = useT();
  const formId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <>
          {destructive && <div className="mr-auto flex items-center gap-2">{destructive}</div>}
          <Button variant="secondary" onClick={onClose}>{t.cancel}</Button>
          {extraActions}
          <Button type="submit" form={formId} disabled={submitDisabled} loading={submitting}>{submitLabel}</Button>
        </>
      }
    >
      <form
        id={formId}
        // The forms validate themselves (lib/validate, inline errors): no browser
        // bubbles, and a step="0.01" or type="email" field never blocks the submit.
        noValidate
        className={FORM_STACK}
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitDisabled && !submitting) onSubmit();
        }}
      >
        {children}
      </form>
    </Modal>
  );
}
