import { ScanLine } from "lucide-react";
import { useT } from "../i18n/useT";
import { Badge } from "./ui/Badge";
import { IconButton } from "./ui/IconButton";
import { ICONS, ICON_SIZE } from "./ui/icons";

/**
 * "From receipt" chip shown next to a form label when the field value came
 * from OCR/PDF receipt parsing, so wrong extractions don't look hand-typed.
 * The × clears the detected value (the caller resets the field).
 */
export function DetectedBadge({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <Badge variant="accent" size="xs" className="pr-0.5">
      <ScanLine size={ICON_SIZE.pill} />
      {t.from_receipt}
      <IconButton icon={ICONS.close} label={t.clear_detected_value} size="xs" tone="danger" onClick={onClear} className="p-0! rounded-full" />
    </Badge>
  );
}
