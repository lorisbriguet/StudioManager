import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { orgPaths } from "./orgPaths";

/** Strip path separators and `..` so a reference/supplier can't escape receiptsDir. */
export function sanitizeSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

/**
 * Copy a file into the active org's receipts directory as
 * `<reference>_<label>.<ext>` (both sanitised) and return the new path.
 * Used when attaching a picked file and when saving a prefilled receipt.
 */
export async function copyIntoReceipts(srcPath: string, reference: string, label: string): Promise<string> {
  const ext = srcPath.split(".").pop() ?? "pdf";
  const { receiptsDir } = await orgPaths();
  if (!(await exists(receiptsDir))) {
    await mkdir(receiptsDir, { recursive: true });
  }
  const destPath = `${receiptsDir}/${sanitizeSegment(reference)}_${sanitizeSegment(label)}.${ext}`;
  await copyFile(srcPath, destPath);
  return destPath;
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
  onError: (err: unknown) => void
): Promise<void> {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Files", extensions: ["pdf", "png", "jpg", "jpeg", "heic"] }],
    });
    if (!selected) return;
    update(await copyIntoReceipts(selected, reference, label));
  } catch (e) {
    onError(e);
  }
}
