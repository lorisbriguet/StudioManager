import { useAppStore } from "../stores/app-store";

export type ActiveMode = "test" | "presentation" | null;

/** The sandbox mode the app is in, if any. Its data is a copy: nothing done
 *  in it may reach real files, the Apple Calendar or the backup folder. */
export function activeMode(): ActiveMode {
  const { testMode, presentationMode } = useAppStore.getState();
  if (presentationMode) return "presentation";
  if (testMode) return "test";
  return null;
}

export function modeActive(): boolean {
  return activeMode() !== null;
}
