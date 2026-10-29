import { useState } from "react";
import { notify } from "../lib/notify";
import { useT } from "../i18n/useT";
import { useConfirm } from "../lib/confirm";
import { exitPresentationMode, exitTestMode } from "../lib/modes";

export type AppMode = "test" | "presentation";

/**
 * Leaving test or presentation mode, from the banner (MainLayout) or from
 * Settings: ask first (the mode's data is thrown away), switch back to the
 * production database, then reload.
 *
 *   const { exitMode, exiting } = useExitMode();
 *   <Button onClick={() => exitMode("test")} disabled={exiting === "test"}>…</Button>
 */
export function useExitMode() {
  const t = useT();
  const confirm = useConfirm();
  const [exiting, setExiting] = useState<AppMode | null>(null);

  const exitMode = async (mode: AppMode) => {
    const test = mode === "test";
    const ok = await confirm({
      title: test ? t.exit_test_mode_title : t.exit_presentation_mode_title,
      message: test ? t.test_mode_confirm_exit : t.presentation_mode_confirm_exit,
      confirmLabel: test ? t.exit_test_mode : t.exit_presentation_mode,
      tone: "danger",
    });
    if (!ok) return;
    setExiting(mode);
    try {
      await (test ? exitTestMode() : exitPresentationMode());
      notify.success(test ? t.toast_test_mode_exited : t.toast_presentation_exited);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      notify.error(test ? t.toast_test_mode_failed : t.toast_presentation_failed, e);
    } finally {
      setExiting(null);
    }
  };

  return { exitMode, exiting };
}
