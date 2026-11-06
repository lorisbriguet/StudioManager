import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleInterval } from "./visibleInterval";

let state: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  state = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ticks while visible", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("skips ticks while hidden and runs once on return", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops after cleanup", () => {
    const tick = vi.fn();
    visibleInterval(tick, 1000)();
    vi.advanceTimersByTime(3000);
    setVisibility("visible");
    expect(tick).not.toHaveBeenCalled();
  });
});
