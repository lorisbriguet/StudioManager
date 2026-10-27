import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDbChangedListener } from "../hooks/useDbChangedListener";

let cb: (() => void) | null = null;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_n: string, f: () => void) => { cb = f; return unlisten; }),
}));

beforeEach(() => { vi.useFakeTimers(); cb = null; unlisten.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useDbChangedListener", () => {
  it("debounces bursts into one invalidation and unlistens on unmount", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { unmount } = renderHook(() => useDbChangedListener(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(cb).not.toBeNull();
    cb!(); cb!(); cb!();
    await vi.advanceTimersByTimeAsync(399);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(unlisten).toHaveBeenCalled();
  });
});
