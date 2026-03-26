/**
 * Structured logging via @tauri-apps/plugin-log.
 * Falls back to console.* in browser/dev environments.
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

export async function logError(message: string, ...args: unknown[]) {
  const log = await getTauriLog();
  const formatted = args.length ? `${message} ${args.map(String).join(" ")}` : message;
  if (log) {
    log.error(formatted);
  } else {
    console.error(formatted);
  }
}

export async function logWarn(message: string, ...args: unknown[]) {
  const log = await getTauriLog();
  const formatted = args.length ? `${message} ${args.map(String).join(" ")}` : message;
  if (log) {
    log.warn(formatted);
  } else {
    console.warn(formatted);
  }
}

export async function logInfo(message: string, ...args: unknown[]) {
  const log = await getTauriLog();
  const formatted = args.length ? `${message} ${args.map(String).join(" ")}` : message;
  if (log) {
    log.info(formatted);
  } else {
    console.log(formatted);
  }
}

export async function logDebug(message: string, ...args: unknown[]) {
  const log = await getTauriLog();
  const formatted = args.length ? `${message} ${args.map(String).join(" ")}` : message;
  if (log) {
    log.debug(formatted);
  } else {
    console.debug(formatted);
  }
}
