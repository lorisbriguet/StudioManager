import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { orgPaths } from "./orgPaths";

/** Strip path separators and `..` so a reference/supplier can't escape receiptsDir. */
export function sanitizeSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

/**
 * Shared "attach an existing receipt" flow for expenses and income: opens a
 * file picker, sanitises `reference`/`label` into a filename, copies the
 * picked file into the active org's receipts directory, then hands the
 * destination path to `update` so the caller can run its own mutation (and
 * its own success toast — timed to the mutation's `onSuccess`, not to this
 * function returning). Any failure before that point (dialog, fs) calls
 * `onError` instead, so each page can keep its own error copy.
 */
export async function attachReceipt(
  reference: string,
  label: string,
  update: (destPath: string) => void,
  onError: () => void
): Promise<void> {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Files", extensions: ["pdf", "png", "jpg", "jpeg", "heic"] }],
    });
    if (!selected) return;
    const filePath = selected;
    const ext = filePath.split(".").pop() ?? "pdf";
    const { receiptsDir } = await orgPaths();
    if (!(await exists(receiptsDir))) {
      await mkdir(receiptsDir, { recursive: true });
    }
    const safeRef = sanitizeSegment(reference);
    const safeLabel = sanitizeSegment(label);
    const destPath = `${receiptsDir}/${safeRef}_${safeLabel}.${ext}`;
    await copyFile(filePath, destPath);
    update(destPath);
  } catch {
    onError();
  }
}
