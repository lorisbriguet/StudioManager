import { useT } from "../../i18n/useT";
import { TAG_COLOR_NAMES, type TagColorName } from "../../lib/tagColors";

export function ColorSwatchPicker({ value, onChange }: { value: TagColorName | null; onChange: (c: TagColorName | null) => void }) {
  const t = useT();
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? e.target.value as TagColorName : null)}
      className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-2 py-1 text-xs"
    >
      <option value="">{t.auto}</option>
      {TAG_COLOR_NAMES.map((name) => (
        <option key={name} value={name}>{name.charAt(0).toUpperCase() + name.slice(1)}</option>
      ))}
    </select>
  );
}
