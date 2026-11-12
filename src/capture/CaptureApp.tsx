import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CaptureField } from "../components/agents/CaptureField";
import { CAPTURE_SHOWN, hideCapturePanel } from "../lib/captures";

/**
 * The capture panel (route `/capture`, its own borderless window opened by Control-Option-Space):
 * one CaptureField. Saving or Escape hides the panel; it starts empty each time it shows.
 */
export function CaptureApp() {
  // A new key remounts the field: text, picked project and messages all start over.
  const [round, setRound] = useState(0);

  useEffect(() => {
    let off: (() => void) | undefined;
    let live = true;
    void listen(CAPTURE_SHOWN, () => setRound((n) => n + 1)).then((un) => {
      if (live) off = un;
      else un();
    });
    return () => {
      live = false;
      off?.();
    };
  }, []);

  const hide = () => void hideCapturePanel();

  return (
    <div className="min-h-screen pb-2 bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden rounded-xl border border-[var(--color-border)]">
      <CaptureField key={round} source="hotkey" autoFocus onSaved={hide} onClose={hide} />
    </div>
  );
}
