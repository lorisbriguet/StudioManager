import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useAppStore } from "../stores/app-store";
import { logWarn } from "./log";

/**
 * Request notification permission proactively on app startup.
 * Call once from App.tsx so the OS prompt appears early.
 */
export async function requestNotificationPermission(): Promise<void> {
  try {
    const granted = await isPermissionGranted();
    if (!granted) {
      await requestPermission();
    }
  } catch {
    // Permission request failure is non-critical
  }
}

/**
 * Send a macOS native notification banner.
 * Reads nativeNotifications from app store — skips if disabled.
 * Failures are logged but never break the app.
 */
export async function sendNativeNotification(
  title: string,
  body: string
): Promise<void> {
  try {
    const { nativeNotifications } = useAppStore.getState();
    if (!nativeNotifications) return;

    const granted = await isPermissionGranted();
    if (!granted) return;

    sendNotification({ title, body });
  } catch (e) {
    logWarn("[Notification] Failed to send:", e);
  }
}
