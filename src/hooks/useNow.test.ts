import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./useNow";

afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("starts at the current time and moves on every interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result, unmount } = renderHook(() => useNow(30_000));
    expect(result.current).toBe(1_000_000);

    act(() => vi.advanceTimersByTime(29_999));
    expect(result.current).toBe(1_000_000);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(1_030_000);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
