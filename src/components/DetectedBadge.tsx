import { ScanLine, X } from "lucide-react";
import { useT } from "../i18n/useT";

/**
 * "From receipt" chip shown next to a form label when the field value came
 * from OCR/PDF receipt parsing, so wrong extractions don't look hand-typed.
 * The ✕ clears the detected value (the caller resets the field).
 */
export function DetectedBadge({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent bg-accent-light rounded-full pl-1.5 pr-1 py-px">
      <ScanLine size={10} aria-hidden="true" />
      {t.from_receipt}
      <button
        type="button"
        onClick={onClear}
        aria-label={t.clear_detected_value}
        className="hover:text-[var(--color-danger-text)]"
      >
        <X size={10} />
      </button>
    </span>
  );
}
