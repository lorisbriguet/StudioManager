import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Conversation, isWorkingNow } from "../components/agents/Conversation";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import type { Item } from "../lib/agents";

const scrollIntoView = vi.fn();

/** A scroller like AgentDetail's, with a layout jsdom doesn't have: 1000 px tall content in a 400 px box. */
function renderIn(working: boolean) {
  const view = render(
    <div data-testid="scroller">
      <Conversation sessionId="s1" working={working} />
    </div>,
  );
  const scroller = screen.getByTestId("scroller");
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
  const scrollTo = (top: number) => {
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: top });
    fireEvent.scroll(scroller);
  };
  return { ...view, scrollTo };
}

let replies = 1;
const messages = () => Array.from({ length: replies }, (_, i) => ({ kind: "assistant", text: `reply ${i}`, at: null }));

describe("isWorkingNow", () => {
  const now = Date.parse("2026-10-29T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const reply = (ms: number): Item => ({ kind: "assistant", text: "done", at: ago(ms) });
  const tool = (ms: number): Item => ({ kind: "tool", name: "Bash", summary: "", at: ago(ms) });

  it("is never on while the agent is not working", () => {
    expect(isWorkingNow(false, [tool(0)], now)).toBe(false);
  });

  it("is off once the agent's own reply has sat for a few seconds, even if the status stays busy", () => {
    expect(isWorkingNow(true, [reply(60_000)], now)).toBe(false);
    expect(isWorkingNow(true, [tool(60_000), reply(9_000)], now)).toBe(false);
  });

  it("is on right after a reply (a tool call may follow), after a tool call and after your message", () => {
    expect(isWorkingNow(true, [reply(2_000)], now)).toBe(true);
    expect(isWorkingNow(true, [reply(60_000), tool(30_000)], now)).toBe(true);
    expect(isWorkingNow(true, [reply(60_000), { kind: "user", text: "go on", at: ago(1000) }], now)).toBe(true);
    expect(isWorkingNow(true, [], now)).toBe(true);
  });
});

describe("Conversation keeps the reader's place when the window slides", () => {
  const msg = (n: number): Item => ({ kind: "assistant", text: `message ${n}`, at: null });
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  let window_: Item[];
  let scrollTop = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    scrollTop = 0;
    window_ = [0, 1, 2, 3, 4, 5].map(msg);
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? window_ : null));
    // A layout jsdom lacks: a 400 px scroller (top 0) over rows 100 px high, one under the other.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const rect = (top: number, h: number) => ({ top, bottom: top + h, left: 0, right: 0, width: 0, height: h, x: 0, y: top, toJSON() {} });
      if (this.getAttribute("data-testid") === "scroller") return rect(0, 400);
      if (this.dataset.anchorKey) {
        const rows = Array.from(document.querySelectorAll("[data-anchor-key]"));
        return rect(rows.indexOf(this) * 100 - scrollTop, 100);
      }
      return rect(0, 0);
    } as typeof HTMLElement.prototype.getBoundingClientRect;
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect;
    vi.useRealTimers();
  });

  it("scrolls back by the height of the message that slid off the top", async () => {
    render(
      <div data-testid="scroller">
        <Conversation sessionId="s1" working={true} />
      </div>,
    );
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });

    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    scrollTop = 250; // reading in the middle: 350 px above the bottom
    fireEvent.scroll(scroller);

    // A new message arrives and the oldest drops off the top: every row moves up by 100 px.
    window_ = [1, 2, 3, 4, 5, 6].map(msg);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

    expect(screen.queryByText("message 0")).not.toBeInTheDocument();
    expect(screen.getByText("message 6")).toBeInTheDocument();
    expect(scrollTop).toBe(150); // message 2 is still where the reader saw it
  });
});

describe("Conversation scrolling and working indicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replies = 1;
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? messages() : null));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function tick() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
  }

  it("follows new replies while the reader is at the bottom", async () => {
    const { scrollTo } = renderIn(true);
    await tick();
    scrollTo(600); // 1000 - 600 - 400 = 0 px from the bottom
    scrollIntoView.mockClear();
    replies = 2;
    await tick();
    expect(screen.getByText("reply 1")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("leaves the reader alone after they scroll up", async () => {
    const { scrollTo } = renderIn(true);
    await tick();
    scrollTo(100); // 500 px above the bottom
    scrollIntoView.mockClear();
    replies = 2;
    await tick();
    await tick(); // an unchanged poll must not pull them down either
    expect(screen.getByText("reply 1")).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("shows the working indicator only while the agent works", async () => {
    const { rerender } = renderIn(true);
    await tick();
    expect(screen.getByTestId("agent-working")).toBeInTheDocument();
    rerender(
      <div data-testid="scroller">
        <Conversation sessionId="s1" working={false} />
      </div>,
    );
    expect(screen.queryByTestId("agent-working")).not.toBeInTheDocument();
  });
});
