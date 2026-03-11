import { toast } from "sonner";

/**
 * Show a toast with an undo action. If the user clicks "Undo" within
 * the toast duration, the rollback function is called.
 *
 * Usage:
 *   undoable("Client deleted", async () => { await restoreClient(id, data); });
 */
export function undoable(message: string, rollback: () => Promise<void> | void) {
  toast(message, {
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await rollback();
          toast.success("Action undone");
        } catch {
          toast.error("Failed to undo");
        }
      },
    },
    duration: 5000,
  });
}
