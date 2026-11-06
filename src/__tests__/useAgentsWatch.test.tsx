import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgents, WATCH_EVERY_MS } from "../components/agents/useAgents";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

/** The poller checks every 2 s only while a view shows the list (P7): useAgents says so. */
const watches = () => invokedCommands.filter((c) => c.cmd === "agents_watch").length;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useAgents keeps the poller fast while on screen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearInvokedCommands();
    setInvokeHandler((cmd) => (cmd === "agents_list" ? [] : undefined));
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setInvokeHandler(null);
    setVisibility("visible");
  });

  it("tells the poller on mount and every few seconds while visible", () => {
    const { unmount } = renderHook(() => useAgents());
    expect(watches()).toBe(1);
    act(() => void vi.advanceTimersByTime(WATCH_EVERY_MS * 2));
    expect(watches()).toBe(3);
    unmount();
    act(() => void vi.advanceTimersByTime(WATCH_EVERY_MS * 3));
    expect(watches()).toBe(3);
  });

  it("stops while hidden and tells it again at once when shown", () => {
    renderHook(() => useAgents());
    expect(watches()).toBe(1);
    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(WATCH_EVERY_MS * 3));
    expect(watches()).toBe(1);
    act(() => setVisibility("visible"));
    expect(watches()).toBe(2);
  });
});
