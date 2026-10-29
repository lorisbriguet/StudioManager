import { useSyncExternalStore } from "react";
import type { Item } from "./agents";

/**
 * Messages sent to an agent that its transcript does not show yet: transmitted, but not
 * taken into account. The conversation shows them greyed out until the agent's transcript
 * holds the same user message, then drops them.
 */

export interface Sent {
  text: string;
  sentAt: number;
}

/** A message the transcript never shows (the agent was closed, the text got rewritten) stops waiting after this. */
const EXPIRE_MS = 30 * 60 * 1000;
/** Clock slack between this app and the transcript's timestamps. */
const SLACK_MS = 5000;

const EMPTY: Sent[] = [];
const bySession = new Map<string, Sent[]>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const norm = (s: string) => s.trim().replace(/\s+/g, " ");

export function addSent(sessionId: string, text: string, now = Date.now()) {
  bySession.set(sessionId, [...(bySession.get(sessionId) ?? EMPTY), { text, sentAt: now }]);
  emit();
}

/**
 * The messages of `sent` the conversation does not hold yet. Each user message in the
 * transcript accounts for at most one sent message with the same text, sent before it.
 */
export function unread(sent: Sent[], items: Item[], now = Date.now()): Sent[] {
  const taken = new Set<number>();
  return sent.filter((s) => {
    if (now - s.sentAt > EXPIRE_MS) return false;
    const i = items.findIndex(
      (it, idx) =>
        !taken.has(idx) &&
        it.kind === "user" &&
        norm(it.text) === norm(s.text) &&
        (!it.at || Date.parse(it.at) >= s.sentAt - SLACK_MS),
    );
    if (i === -1) return true;
    taken.add(i);
    return false;
  });
}

/** Forgets the sent messages the transcript now holds (or that expired). */
export function settle(sessionId: string, items: Item[], now = Date.now()) {
  const sent = bySession.get(sessionId);
  if (!sent?.length) return;
  const rest = unread(sent, items, now);
  if (rest.length === sent.length) return;
  if (rest.length === 0) bySession.delete(sessionId);
  else bySession.set(sessionId, rest);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The sent messages of one agent still waiting to show in its transcript. */
export function useSent(sessionId: string): Sent[] {
  return useSyncExternalStore(subscribe, () => bySession.get(sessionId) ?? EMPTY);
}

/** For tests. */
export function clearSent() {
  bySession.clear();
  emit();
}
