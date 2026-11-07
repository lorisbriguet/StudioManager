import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInvokedCommands, invokedCommands } from "../__mocks__/tauri-api";
import { SHOW_FALLBACK_MS, showMainWindowWhenPainted } from "../lib/showMainWindow";

const readyCalls = () => invokedCommands.filter((c) => c.cmd === "main_ready").length;

describe("showMainWindowWhenPainted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearInvokedCommands();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the app once, on the next frame", () => {
    showMainWindowWhenPainted();
    expect(readyCalls()).toBe(0);
    vi.advanceTimersByTime(SHOW_FALLBACK_MS + 10);
    expect(readyCalls()).toBe(1);
  });

  it("still tells the app when no frame comes (hidden window)", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    showMainWindowWhenPainted();
    vi.advanceTimersByTime(SHOW_FALLBACK_MS);
    expect(readyCalls()).toBe(1);
    raf.mockRestore();
  });
});
