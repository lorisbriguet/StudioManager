import { DropdownSelect } from "../ui";

export const MODELS = ["haiku", "sonnet", "opus", "fable"];

/** The model each short name points to today. The CLI's short names always mean the latest
 *  version and it can't report which one, so update these when new models ship. */
export const MODEL_LABELS: Record<string, string> = {
  haiku: "Haiku 5.5",
  sonnet: "Sonnet 5.5",
  opus: "Opus 5.5",
  fable: "Fable 5.1",
};

interface ModelMenuProps {
  value: string | null;
  /** The exact model in use, when known (e.g. from the agent's transcript). */
  currentLabel?: string | null;
  onChange: (model: string) => void;
  label: string;
  disabled?: boolean;
  /** Set by FormField, so its label points at the trigger. */
  id?: string;
}

const OPTIONS = MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] ?? m }));

/** The model picker: a DropdownSelect named by `label`, showing the exact model when known. */
export function ModelMenu({ value, currentLabel, onChange, label, disabled, id }: ModelMenuProps) {
  return (
    <DropdownSelect
      id={id}
      aria-label={label}
      options={OPTIONS}
      value={value ?? ""}
      placeholder={label}
      disabled={disabled}
      align="end"
      renderValue={currentLabel ? () => currentLabel : undefined}
      onChange={(m) => {
        if (m && m !== value) onChange(m);
      }}
    />
  );
}
