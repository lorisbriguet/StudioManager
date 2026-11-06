import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDbChangedListener } from "../hooks/useDbChangedListener";

let cb: ((e: { payload: string[] | null }) => void) | null = null;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_n: string, f: (e: { payload: string[] | null }) => void) => { cb = f; return unlisten; }),
}));
const syncAll = vi.fn(async () => 0);
vi.mock("../lib/upkeep/calendar", () => ({ syncAllUpkeepEvents: () => syncAll() }));

beforeEach(() => { vi.useFakeTimers(); cb = null; unlisten.mockClear(); syncAll.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function mount() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useDbChangedListener(), { wrapper });
  await vi.advanceTimersByTimeAsync(0);
  expect(cb).not.toBeNull();
  const keys = () => spy.mock.calls.map((c) => (c[0] as { queryKey?: string[] } | undefined)?.queryKey?.[0] ?? "ALL");
  return { spy, keys, ...hook };
}

describe("useDbChangedListener", () => {
  it("debounces bursts into one refresh and unlistens on unmount", async () => {
    const { spy, keys, unmount } = await mount();
    cb!({ payload: ["create_task"] }); cb!({ payload: ["update_task"] }); cb!({ payload: ["create_task"] });
    await vi.advanceTimersByTimeAsync(399);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(keys()).toEqual(["tasks", "subtasks", "workload-rows", "projects"]);
    expect(syncAll).not.toHaveBeenCalled(); // no upkeep tool
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(unlisten).toHaveBeenCalled();
  });

  it("an upkeep tool refreshes upkeep queries and syncs the calendar", async () => {
    const { keys } = await mount();
    cb!({ payload: ["mark_upkeep_done"] });
    await vi.advanceTimersByTimeAsync(401);
    expect(keys()).toEqual(["upkeep-items", "machines", "service-log"]);
    expect(syncAll).toHaveBeenCalledTimes(1);
  });

  it("refreshes everything when the tools are unknown or unnamed", async () => {
    const { spy, keys } = await mount();
    cb!({ payload: ["create_task"] }); cb!({ payload: null });
    await vi.advanceTimersByTimeAsync(401);
    expect(keys()).toEqual(["ALL"]);
    expect(syncAll).toHaveBeenCalledTimes(1);
    spy.mockClear(); syncAll.mockClear();
    cb!({ payload: ["some_new_tool"] });
    await vi.advanceTimersByTimeAsync(401);
    expect(keys()).toEqual(["ALL"]);
    expect(syncAll).toHaveBeenCalledTimes(1);
    // The next burst starts fresh.
    spy.mockClear();
    cb!({ payload: ["create_client"] });
    await vi.advanceTimersByTimeAsync(401);
    expect(keys()).toEqual(["clients"]);
  });
});
