/**
 * Structured logging via @tauri-apps/plugin-log (the app log file, see
 * `log_plugin` in src-tauri/src/lib.rs).
 * Falls back to console.* in the browser, or when the plugin call fails,
 * so an error is never dropped silently.
 */

let tauriLog: typeof import("@tauri-apps/plugin-log") | null = null;

// Lazy-load the Tauri log plugin (no-op in browser)
async function getTauriLog() {
  if (tauriLog) return tauriLog;
  try {
    tauriLog = await import("@tauri-apps/plugin-log");
    return tauriLog;
  } catch {
    return null;
  }
}

type Level = "error" | "warn" | "info";
const consoleFor: Record<Level, (msg: string) => void> = {
  error: (m) => console.error(m),
  warn: (m) => console.warn(m),
  info: (m) => console.log(m),
};

async function write(level: Level, message: string, args: unknown[]) {
  const formatted = args.length ? `${message} ${args.map(String).join(" ")}` : message;
  const log = await getTauriLog();
  if (log) {
    try {
      await log[level](formatted);
      return;
    } catch {
      // Plugin missing or the call failed: fall through to the console.
    }
  }
  consoleFor[level](formatted);
}

export function logError(message: string, ...args: unknown[]) {
  return write("error", message, args);
}

export function logWarn(message: string, ...args: unknown[]) {
  return write("warn", message, args);
}

export function logInfo(message: string, ...args: unknown[]) {
  return write("info", message, args);
}
