import { invoke } from "@tauri-apps/api/core";
import { logError } from "./log";

/**
 * Extract text from a PDF via the `extract_pdf_text` Rust command, which
 * runs a fixed JXA/PDFKit script with the path passed as argv only.
 */
export async function extractPdfText(filePath: string): Promise<string> {
  const extraction = invoke<string>("extract_pdf_text", { path: filePath }).then(
    (text) => text.trim(),
    (e) => {
      logError("PDF extraction failed:", e);
      return "";
    }
  );
  return Promise.race([
    extraction,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("PDF extraction timed out")), 15000)
    ),
  ]);
}

/**
 * Extract text from an image via the `ocr_image_text` Rust command, which
 * runs the native Vision framework (VNRecognizeTextRequest, fr/de/en) with
 * the path passed as argv only. Reads JPEG, PNG and HEIC natively — no
 * conversion step and no language-data downloads.
 * 15s timeout to match PDF extraction.
 */
export async function extractImageText(filePath: string): Promise<string> {
  const recognition = invoke<string>("ocr_image_text", { path: filePath }).then((text) =>
    text.trim()
  );
  return Promise.race([
    recognition,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timed out")), 15000)
    ),
  ]);
}
