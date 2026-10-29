import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Conversation } from "../components/agents/Conversation";
import { setInvokeHandler } from "../__mocks__/tauri-api";

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
