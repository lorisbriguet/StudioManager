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
  // Where the jump to the latest message on load leaves it.
  Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 600 });
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
    scrollTop = 600; // where the jump to the latest message on load leaves it

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

  it("offers a jump to the latest message once the reader scrolls up", async () => {
    const { scrollTo } = renderIn(true);
    await tick();
    expect(screen.queryByRole("button", { name: "Jump to the latest message" })).toBeNull();
    scrollTo(100);
    const jump = screen.getByRole("button", { name: "Jump to the latest message" });
    const scroller = screen.getByTestId("scroller");
    const smooth = vi.fn();
    scroller.scrollTo = smooth as unknown as typeof scroller.scrollTo;
    fireEvent.click(jump);
    expect(smooth).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(screen.queryByRole("button", { name: "Jump to the latest message" })).toBeNull();
  });

  it("stays pinned to the bottom when the size changes after loading, until the reader scrolls up", async () => {
    const observers: (() => void)[] = [];
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      renderIn(true);
      await tick();
      const scroller = screen.getByTestId("scroller");
      let top = 0;
      Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = v; } });
      // The panel finished sliding in: the size changed after the first jump.
      act(() => observers.forEach((cb) => cb()));
      expect(top).toBe(1000);
      top = 100;
      fireEvent.scroll(scroller);
      act(() => observers.forEach((cb) => cb()));
      expect(top).toBe(100);
    } finally {
      globalThis.ResizeObserver = Real;
    }
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

describe("Conversation opens at the latest message (subtask 322)", () => {
  const observers: (() => void)[] = [];
  const Real = globalThis.ResizeObserver;
  let height = 1000;
  let top = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    observers.length = 0;
    height = 1000;
    top = 0;
    replies = 3;
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? messages() : null));
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = Real;
    vi.useRealTimers();
  });

  /** A 400 px scroller whose scrollTop is clamped like a browser's. */
  function mount(sessionId = "s1") {
    const view = render(
      <div data-testid="scroller">
        <Conversation sessionId={sessionId} working={false} />
      </div>,
    );
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, height - scroller.clientHeight));
      },
    });
    const resized = () => act(() => observers.forEach((cb) => cb()));
    return { ...view, scroller, resized };
  }

  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(10); });

  it("stays at the bottom when the content grows before the scroll event of its own jump", async () => {
    const { scroller, resized } = mount();
    await settle();
    resized();
    expect(top).toBe(600);
    // Code blocks and images lay out late: the content grows by 500 px, then the scroll
    // event of the jump above arrives, measured against the new height.
    height = 1500;
    fireEvent.scroll(scroller);
    resized();
    expect(top).toBe(1100);
    expect(screen.queryByRole("button", { name: "Jump to the latest message" })).toBeNull();
  });

  it("stays at the bottom when the question card above makes the scroller shorter", async () => {
    const { scroller, resized } = mount();
    await settle();
    resized();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 250 });
    fireEvent.scroll(scroller);
    resized();
    expect(top).toBe(750);
  });

  it("still lets the reader scroll up, and follows again once they are back at the bottom", async () => {
    const { scroller, resized } = mount();
    await settle();
    resized();
    top = 200;
    fireEvent.scroll(scroller);
    height = 1500;
    resized();
    expect(top).toBe(200);
    top = 1100;
    fireEvent.scroll(scroller);
    height = 1800;
    resized();
    expect(top).toBe(1400);
  });

  it("opens another session at its latest message after the reader scrolled up in this one", async () => {
    const { scroller, resized, rerender } = mount();
    await settle();
    resized();
    top = 100;
    fireEvent.scroll(scroller);
    rerender(
      <div data-testid="scroller">
        <Conversation sessionId="s2" working={false} />
      </div>,
    );
    // The list empties first: the browser clamps the position to 0 and reports a scroll.
    height = 400;
    top = 0;
    fireEvent.scroll(scroller);
    await settle();
    // The new transcript renders and grows before the next scroll event.
    height = 1200;
    fireEvent.scroll(scroller);
    resized();
    expect(top).toBe(800);
  });
});
