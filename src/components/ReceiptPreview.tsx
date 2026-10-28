import { useState, useEffect } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { useT } from "../i18n/useT";
import { notifyError } from "../lib/notifyError";
import { Modal } from "./ui";

/**
 * Large preview of an attached receipt (image or PDF), shared by the
 * Expenses and Income pages. A full-size Modal: Esc, backdrop click, focus.
 */
export function ReceiptPreview({
  path,
  reference,
  onClose,
}: {
  path: string;
  reference: string;
  onClose: () => void;
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
    <Modal open onClose={onClose} title={reference} size="full" padding={false}>
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center">
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
    </Modal>
  );
}
