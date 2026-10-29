import { Paperclip } from "lucide-react";
import { useT } from "../../i18n/useT";
import { ICON_SIZE } from "../ui";

/**
 * "Receipt will be attached: file.pdf" — the line at the top of the expense
 * and income forms when they were opened from a dropped receipt.
 */
export function ReceiptNote({ path }: { path: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-xs text-success">
      <Paperclip size={ICON_SIZE.control} />
      <span>{t.receipt_will_be_attached} {path.split("/").pop()}</span>
    </div>
  );
}
