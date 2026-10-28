import { Paperclip } from "lucide-react";
import { useT } from "../../i18n/useT";

/**
 * "Receipt will be attached: file.pdf" — the line at the top of the expense
 * and income forms when they were opened from a dropped receipt.
 */
export function ReceiptNote({ path }: { path: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-xs text-success">
      <Paperclip size={12} aria-hidden="true" />
      <span>{t.receipt_will_be_attached} {path.split("/").pop()}</span>
    </div>
  );
}
