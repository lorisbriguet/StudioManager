import { appDataDir } from "@tauri-apps/api/path";
import { useOrgStore } from "../stores/org-store";
import { activeMode } from "./activeMode";

/** Document folders of the active organisation. In test or presentation mode
 *  they sit in a `test` / `presentation` sub-folder (removed when the mode
 *  ends), so the copied data never overwrites real PDFs or receipts. */
export async function orgPaths(): Promise<{ root: string; invoicesDir: string; receiptsDir: string }> {
  const base = (await appDataDir()).replace(/\/$/, "");
  const id = useOrgStore.getState().activeId;
  const orgRoot = id ? `${base}/orgs/${id}` : base;
  const mode = activeMode();
  const root = mode ? `${orgRoot}/${mode}` : orgRoot;
  return { root, invoicesDir: `${root}/invoices`, receiptsDir: `${root}/receipts` };
}
