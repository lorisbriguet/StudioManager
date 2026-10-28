import { confirm } from "../stores/confirm-store";
import { getLabels } from "./notifyError";

/**
 * Ask before an action, with the app's ConfirmDialog (never the native
 * `ask()`). See DESIGN-SYSTEM.md, "Confirmations".
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: t.confirm_delete_named.replace("{name}", c.name), confirmLabel: t.delete, tone: "danger" }))) return;
 *
 * Non-React code imports `confirm` directly.
 */
export { confirm };
export type { ConfirmOptions, ConfirmResult } from "../stores/confirm-store";

/** `confirm` for components, so they don't import a store. */
export function useConfirm() {
  return confirm;
}

/**
 * "Delete {name}?" with a red Delete button. `message` says what goes with it
 * (a client's projects, a project's tasks).
 */
export function confirmDelete(name: string, message?: string): Promise<boolean> {
  const t = getLabels();
  return confirm({
    title: t.confirm_delete_named.replace("{name}", name),
    message,
    confirmLabel: t.delete,
    tone: "danger",
  });
}
