import type { AccentPreset } from "../../stores/app-store";

export function AccentColorPicker({
  presets,
  value,
  onChange,
}: {
  presets: AccentPreset[];
  value: AccentPreset;
  onChange: (preset: AccentPreset) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((preset) => {
        const isActive = value.color.toLowerCase() === preset.color.toLowerCase();
        return (
          <button
            key={preset.color}
            type="button"
            onClick={() => onChange(preset)}
            title={preset.name}
            className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
              isActive ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--color-bg)]" : ""
            }`}
            style={{ backgroundColor: preset.color }}
          />
        );
      })}
    </div>
  );
}
