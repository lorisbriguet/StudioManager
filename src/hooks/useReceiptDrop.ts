import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { extractPdfText, extractImageText } from "../lib/pdfExtract";
import { parseExpenseFromText, type ExtractedExpenseData } from "../lib/expenseParse";
import { logError } from "../lib/log";
import { useT } from "../i18n/useT";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "heic"];

/**
 * Drag-and-drop receipt intake shared by the expense and income pages:
 * extension gate, PDF-text / Vision-OCR extraction, parsing, and the Tauri
 * drag-drop listener wiring. `onResult` always fires — with `{}` when
 * parsing failed — so the page can open its form with the receipt attached
 * either way.
 */
export function useReceiptDrop({
  onResult,
  getKnownSuppliers,
}: {
  onResult: (extracted: ExtractedExpenseData, filePath: string) => void;
  getKnownSuppliers?: () => string[];
}) {
  const t = useT();
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  // Keep the latest callbacks without re-registering the webview listener
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const suppliersRef = useRef(getKnownSuppliers);
  suppliersRef.current = getKnownSuppliers;

  const handleDroppedFile = useCallback(async (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "pdf" && !IMAGE_EXTS.includes(ext)) {
      toast.error(t.unsupported_file);
      return;
    }
    setParsing(true);
    try {
      let extracted: ExtractedExpenseData = {};
      const suppliers = suppliersRef.current?.() ?? [];
      const text = ext === "pdf" ? await extractPdfText(filePath) : await extractImageText(filePath);
      if (text) extracted = parseExpenseFromText(text, suppliers);
      onResultRef.current(extracted, filePath);
    } catch (e) {
      logError("Receipt parsing failed:", e);
      onResultRef.current({}, filePath);
    } finally {
      setParsing(false);
    }
  }, [t.unsupported_file]);

  useEffect(() => {
    const webview = getCurrentWebview();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    webview.onDragDropEvent((event) => {
      if (cancelled) return;
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragging(true);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        const paths = event.payload.paths;
        if (paths.length > 0) handleDroppedFile(paths[0]);
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      }
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    }).catch((e) => logError("Failed to register drag-drop listener:", e));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleDroppedFile]);

  return { isDragging, parsing, handleDroppedFile };
}
