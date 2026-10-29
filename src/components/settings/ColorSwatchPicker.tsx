import { useT } from "../../i18n/useT";
import { Select } from "../ui";
import { TAG_COLOR_NAMES, type TagColorName } from "../../lib/tagColors";

export function ColorSwatchPicker({ value, onChange }: { value: TagColorName | null; onChange: (c: TagColorName | null) => void }) {
  const t = useT();
  return (
    <Select
      value={value ?? ""}
      aria-label={t.color}
      onChange={(e) => onChange(e.target.value ? e.target.value as TagColorName : null)}
      fullWidth={false}
    >
      <option value="">{t.auto}</option>
      {TAG_COLOR_NAMES.map((name) => (
        <option key={name} value={name}>{name.charAt(0).toUpperCase() + name.slice(1)}</option>
      ))}
    </Select>
  );
}
