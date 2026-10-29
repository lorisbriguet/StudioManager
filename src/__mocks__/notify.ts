import { vi } from "vitest";
import type { ProgressOutcome } from "../lib/notify";

/**
 * A spyable stand-in for `notify` (src/lib/notify.ts), for tests that check
 * which toast a flow shows:
 *
 *   vi.mock("../lib/notify", async (orig) => ({
 *     ...(await orig<typeof import("../lib/notify")>()),
 *     ...(await import("../__mocks__/notify")).notifyMockModule(),
 *   }));
 *   expect(notify.success).toHaveBeenCalledWith("Invoice saved");
 *
 * `progress` runs the work and reports its outcome through the other spies
 * (success / warning / error), so a test sees the end result.
 */
export function notifyMockModule() {
  const notify = {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    undo: vi.fn(),
    progress: vi.fn(
      async <T,>(
        _label: string,
        work: Promise<T> | ((update: (label: string) => void) => Promise<T>),
        msgs: { success: ProgressOutcome | ((r: T) => ProgressOutcome); error: string }
      ): Promise<T | undefined> => {
        try {
          const result = await (typeof work === "function" ? work(() => {}) : work);
          const outcome = typeof msgs.success === "function" ? msgs.success(result) : msgs.success;
          if (typeof outcome === "string") notify.success(outcome);
          else if (outcome) notify.warning(outcome.warning);
          return result;
        } catch (e) {
          notify.error(msgs.error, e);
          return undefined;
        }
      }
    ),
  };
  return { notify };
}
