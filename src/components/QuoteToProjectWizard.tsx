import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, addMonths } from "date-fns";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button, FormField, Modal } from "./ui";
import * as v from "../lib/validate";
import { useT } from "../i18n/useT";
import { useCreateProjectFromQuote } from "../db/hooks/useProjects";
import type { Quote, QuoteLineItem } from "../types/quote";

interface Props {
  open: boolean;
  onClose: () => void;
  quote: Quote;
  lineItems: QuoteLineItem[];
  clientName: string;
}

interface WizardTask {
  included: boolean;
  title: string;
  plannedMinutes: number | null;
}

// Phase 2 E3 — inline validation (E1 pattern) for the project-details step.
type WizardFormField = "name" | "deadline";

const wizardSchema: v.FormSchema<WizardFormField> = {
  name: [v.required],
  deadline: [v.required, v.dateValid],
};

export function QuoteToProjectWizard({ open, onClose, quote, lineItems, clientName }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const createProject = useCreateProjectFromQuote();
  const [step, setStep] = useState(0);

  // Step 1: tasks from line items
  const [tasks, setTasks] = useState<WizardTask[]>(() =>
    lineItems.map((li) => ({
      included: true,
      title: li.designation,
      plannedMinutes: null,
    }))
  );

  // Step 2: project details
  const [projectName, setProjectName] = useState(
    `${quote.reference} — ${clientName}`
  );
  const [deadline, setDeadline] = useState(format(addMonths(new Date(), 1), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Partial<Record<WizardFormField, string>>>({});

  const setFieldError = (field: WizardFormField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });

  const validateOnBlur = (field: WizardFormField) =>
    setFieldError(field, v.validateField(field === "name" ? projectName : deadline, wizardSchema[field]));

  const clearError = (field: WizardFormField) => setFieldError(field, null);

  const includedCount = useMemo(() => tasks.filter((t) => t.included).length, [tasks]);

  const updateTask = (i: number, patch: Partial<WizardTask>) => {
    setTasks((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const handleCreate = async () => {
    const included = tasks
      .filter((t) => t.included)
      .map((t, i) => ({
        title: t.title,
        plannedMinutes: t.plannedMinutes,
        sortOrder: i,
      }));

    const projectId = await createProject.mutateAsync({
      clientId: quote.client_id,
      name: projectName.trim(),
      deadline,
      notes,
      quoteId: quote.id,
      tasks: included,
    });

    toast.success(t.project_generated);
    onClose();
    navigate(`/projects/${projectId}`);
  };

  const steps = [t.step_review_items, t.step_project_details, t.step_confirm];

  return (
    <Modal open={open} onClose={onClose} title={t.generate_project_from_quote} size="lg">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-5">
        {steps.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                i < step
                  ? "bg-[var(--accent)] text-white"
                  : i === step
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--color-input-bg)] text-muted"
              }`}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </div>
            <span className={`text-xs ${i === step ? "font-medium" : "text-muted"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-[var(--color-input-bg)]" />}
          </div>
        ))}
      </div>

      {/* Step 1: Review items */}
      {step === 0 && (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          <div className="grid grid-cols-[auto_1fr_100px] gap-2 text-xs font-medium text-muted pb-1 border-b border-[var(--color-border-divider)] px-1">
            <span>{t.include}</span>
            <span>{t.task_name}</span>
            <span>{t.planned_time}</span>
          </div>
          {tasks.map((task, i) => (
            <div
              key={i}
              className={`grid grid-cols-[auto_1fr_100px] gap-2 items-center py-1.5 px-1 rounded ${
                task.included ? "" : "opacity-40"
              }`}
            >
              <input
                type="checkbox"
                checked={task.included}
                onChange={(e) => updateTask(i, { included: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              <input
                type="text"
                value={task.title}
                onChange={(e) => updateTask(i, { title: e.target.value })}
                className="text-sm border border-[var(--color-input-border)] rounded-lg px-2 py-1"
              />
              <input
                type="number"
                value={task.plannedMinutes ?? ""}
                onChange={(e) =>
                  updateTask(i, {
                    plannedMinutes: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder={t.minutes_short}
                className="text-sm border border-[var(--color-input-border)] rounded-lg px-2 py-1 text-right"
              />
            </div>
          ))}
        </div>
      )}

      {/* Step 2: Project details */}
      {step === 1 && (
        <div className="space-y-3">
          <FormField label={t.project_name} required error={errors.name}>
            <input
              type="text"
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); clearError("name"); }}
              onBlur={() => validateOnBlur("name")}
              className="w-full border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label={t.project_deadline} required error={errors.deadline}>
            <input
              type="date"
              value={deadline}
              onChange={(e) => { setDeadline(e.target.value); clearError("deadline"); }}
              onBlur={() => validateOnBlur("deadline")}
              className="w-full border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label={t.notes}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm"
            />
          </FormField>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 2 && (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{t.project_name}:</span> {projectName}
          </p>
          <p>
            <span className="font-medium">{t.project_deadline}:</span> {deadline}
          </p>
          <p>
            {includedCount} {t.items_to_create}
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-5">
        <Button
          variant="secondary"
          onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
        >
          {step === 0 ? t.cancel : t.back}
        </Button>
        {step < 2 ? (
          <Button
            onClick={() => {
              if (step === 1) {
                const errs = v.validateForm({ name: projectName, deadline }, wizardSchema);
                setErrors(errs);
                if (Object.keys(errs).length > 0) return;
              }
              setStep(step + 1);
            }}
            disabled={step === 0 && includedCount === 0}
          >
            {t.next}
          </Button>
        ) : (
          <Button
            onClick={handleCreate}
            disabled={!projectName.trim() || createProject.isPending}
          >
            {t.confirm_create_project}
          </Button>
        )}
      </div>
    </Modal>
  );
}
