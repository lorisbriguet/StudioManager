import { useSyncExternalStore } from "react";

/**
 * Flagged agent conversations, by session id, kept on this Mac (localStorage). The main
 * window and the menu bar panel share the storage: a flag set in one shows in the other.
 */
const KEY = "agents.flagged";
const EVENT = "agents-flags-changed";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let cache: { raw: string | null; set: ReadonlySet<string> } = { raw: null, set: new Set() };

function snapshot(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage unavailable: no flags.
  }
  if (raw !== cache.raw) cache = { raw, set: new Set(read()) };
  return cache.set;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Flags or unflags a conversation. */
export function setFlagged(sessionId: string, flagged: boolean): void {
  const next = new Set(read());
  if (flagged) next.add(sessionId);
  else next.delete(sessionId);
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // Storage unavailable: the flag can't be kept.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The flagged session ids, updated when a flag changes in this window or another. */
export function useFlaggedAgents(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot);
}
