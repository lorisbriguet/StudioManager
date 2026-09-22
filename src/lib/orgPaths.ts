import { appDataDir } from "@tauri-apps/api/path";
import { useOrgStore } from "../stores/org-store";

/** Document folders of the active organisation. */
export async function orgPaths(): Promise<{ root: string; invoicesDir: string; receiptsDir: string }> {
  const base = (await appDataDir()).replace(/\/$/, "");
  const id = useOrgStore.getState().activeId;
  const root = id ? `${base}/orgs/${id}` : base;
  return { root, invoicesDir: `${root}/invoices`, receiptsDir: `${root}/receipts` };
}
