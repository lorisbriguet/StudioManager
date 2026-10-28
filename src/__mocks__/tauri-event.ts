// Stub for @tauri-apps/api/event. Kept apart from tauri-api.ts so tests that
// vi.mock("@tauri-apps/api/event") do not replace the shared invoke stub.
const listeners = new Map<string, Set<(e: { payload: unknown }) => void>>();

export async function listen<T = unknown>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<() => void> {
  const h = handler as (e: { payload: unknown }) => void;
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(h);
  return () => {
    listeners.get(event)?.delete(h);
  };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  listeners.get(event)?.forEach((h) => h({ payload }));
}
