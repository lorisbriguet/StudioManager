import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Conversation } from "../components/agents/Conversation";
import { addSent, clearSent, unread } from "../lib/outbox";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import type { Item } from "../lib/agents";

const user = (text: string, at: string | null): Item => ({ kind: "user", text, at });
const T0 = Date.parse("2026-10-29T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("unread (sent messages the transcript does not show yet)", () => {
  it("keeps a message until a matching user message appears after it was sent", () => {
    const sent = [{ text: "fix the login", sentAt: T0 }];
    expect(unread(sent, [], T0 + 1000)).toHaveLength(1);
    expect(unread(sent, [user("fix the login", iso(T0 + 3000))], T0 + 4000)).toHaveLength(0);
  });

  it("ignores an older identical message and whitespace differences", () => {
    const sent = [{ text: "run  the tests\n", sentAt: T0 }];
    const old = user("run the tests", iso(T0 - 60_000));
    expect(unread(sent, [old], T0 + 1000)).toHaveLength(1);
    expect(unread(sent, [old, user("run the tests", iso(T0 + 500))], T0 + 1000)).toHaveLength(0);
  });

  it("one transcript message accounts for one sent message", () => {
    const sent = [
      { text: "ok", sentAt: T0 },
      { text: "ok", sentAt: T0 + 1000 },
    ];
    expect(unread(sent, [user("ok", iso(T0 + 2000))], T0 + 3000)).toHaveLength(1);
    expect(unread(sent, [user("ok", iso(T0 + 2000)), user("ok", iso(T0 + 2500))], T0 + 3000)).toHaveLength(0);
  });

  it("gives up on a message after half an hour", () => {
    expect(unread([{ text: "x", sentAt: T0 }], [], T0 + 31 * 60_000)).toHaveLength(0);
  });
});

describe("Conversation shows unread messages greyed out", () => {
  let items: Item[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    clearSent();
    items = [{ kind: "assistant", text: "Working on it", at: null }];
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? items : null));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tick = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

  it("greys a sent message out, then shows it normally once the transcript has it", async () => {
    render(<Conversation sessionId="s1" working={true} />);
    await tick();
    act(() => addSent("s1", "also fix settings"));

    const waiting = screen.getByTestId("agent-unread");
    expect(waiting).toHaveTextContent("also fix settings");
    expect(waiting).toHaveTextContent("Sent, not read yet");
    expect(waiting.querySelector(".opacity-50")).not.toBeNull();

    items = [...items, user("also fix settings", new Date().toISOString())];
    await tick();
    expect(screen.queryByTestId("agent-unread")).not.toBeInTheDocument();
    expect(screen.getByText("also fix settings")).toBeInTheDocument();
  });

  it("keeps the message of another agent out of this conversation", async () => {
    render(<Conversation sessionId="s1" working={true} />);
    await tick();
    act(() => addSent("other", "not for s1"));
    expect(screen.queryByTestId("agent-unread")).not.toBeInTheDocument();
  });
});
