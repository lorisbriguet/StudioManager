import { invoke } from "@tauri-apps/api/core";
import { readFile, remove } from "@tauri-apps/plugin-fs";
import { logError } from "./log";

// Singleton OCR worker — lazy-loaded to avoid ~300KB bundle cost upfront.
// Reused across calls to avoid re-downloading ~15MB language data each time.
let ocrWorker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;

/**
 * True once the OCR worker singleton has been created. Lets callers show a
 * "first run downloads language data" hint before the initial (slow) init.
 */
export function isOcrWorkerReady(): boolean {
  return ocrWorker !== null;
}

async function getOCRWorker() {
  if (!ocrWorker) {
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("fra+deu+eng");
  }
  return ocrWorker;
}

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
 * Convert HEIC to JPEG via the `convert_heic_to_jpeg` Rust command, which
 * invokes the system `sips` binary directly (no shell involved). The JPEG
 * lands in APPDATA — inside the frontend fs scope — so it can be read and
 * cleaned up through the fs plugin.
 */
async function convertHeicToJpeg(filePath: string): Promise<Uint8Array> {
  const outPath = await invoke<string>("convert_heic_to_jpeg", { path: filePath });
  try {
    return await readFile(outPath);
  } finally {
    await remove(outPath).catch(() => {});
  }
}

/**
 * Extract text from an image using Tesseract.js OCR (browser-based, web worker).
 * Supports JPEG, PNG, and HEIC (converted via macOS sips).
 * Language data (~15MB) is cached after first use.
 * 15s timeout to match PDF extraction.
 */
export async function extractImageText(filePath: string): Promise<string> {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const bytes = ext === "heic" ? await convertHeicToJpeg(filePath) : await readFile(filePath);
  const blob = new Blob([new Uint8Array(bytes)]);

  const worker = await getOCRWorker();
  const result = await Promise.race([
    worker.recognize(blob),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timed out")), 15000)
    ),
  ]);
  return result.data.text.trim();
}
