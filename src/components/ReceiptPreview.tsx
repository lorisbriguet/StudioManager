import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { readFile } from "@tauri-apps/plugin-fs";
import { useT } from "../i18n/useT";
import { notifyError } from "../lib/notifyError";

/**
 * Full-screen preview of an attached receipt (image or PDF), shared by the
 * Expenses and Income pages. The two pages use different surface tokens for
 * the modal — `bgClassName`/`roundedClassName` keep that difference a caller
 * choice instead of picking one page's look for both.
 */
export function ReceiptPreview({
  path,
  reference,
  onClose,
  bgClassName,
  roundedClassName,
}: {
  path: string;
  reference: string;
  onClose: () => void;
  bgClassName: string;
  roundedClassName: string;
}) {
  const t = useT();
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    readFile(path)
      .then((bytes) => {
        const mime = isImage
          ? `image/${ext === "jpg" ? "jpeg" : ext}`
          : "application/pdf";
        const blob = new Blob([bytes], { type: mime });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch((err) => {
        setBlobUrl(null);
        notifyError(t.receipt_load_failed, err);
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, ext, isImage, t.receipt_load_failed]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className={`${bgClassName} ${roundedClassName} shadow-xl w-[80vw] h-[85vh] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-input-border)]">
          <h2 className="text-sm font-semibold">{reference}</h2>
          <button onClick={onClose} aria-label={t.close} className="text-muted hover:text-[var(--color-text)]">
            <X size={16} />
          </button>
        </div>
        <div className={`flex-1 overflow-auto ${bgClassName} flex items-center justify-center`}>
          {!blobUrl ? (
            <span className="text-sm text-muted">{t.loading}</span>
          ) : isImage ? (
            <img
              src={blobUrl}
              alt={reference}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <iframe
              src={blobUrl}
              title={reference}
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
