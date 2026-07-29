import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAppStore } from "../stores/app-store";
import { useTimerActions } from "../hooks/useTimerActions";
import { createTimeEntry } from "../db/queries/timeEntries";
import { getTaskById } from "../db/queries/tasks";
import { getProject } from "../db/queries/projects";
import { notifyError } from "../lib/notifyError";
import type { Task } from "../types/task";
import type { Project } from "../types/project";

vi.mock("../db/queries/timeEntries", () => ({ createTimeEntry: vi.fn() }));
vi.mock("../db/queries/tasks", () => ({ getTaskById: vi.fn() }));
vi.mock("../db/queries/projects", () => ({ getProject: vi.fn() }));
vi.mock("../lib/notifyError", () => ({ notifyError: vi.fn() }));

const mockTask = { id: 1, tracked_minutes: 15 } as unknown as Task;
const mockProject = { id: 2, name: "Proj" } as unknown as Project;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const FIVE_MIN = 5 * 60_000;

/** Simulate a running timer started 5 minutes ago (state + persisted copy). */
function seedRunningTimer() {
  const timer = { taskId: 1, projectId: 2, startedAt: Date.now() - FIVE_MIN, projectName: "Proj" };
  useAppStore.setState({ activeTimer: timer });
  localStorage.setItem("activeTimer", JSON.stringify(timer));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAppStore.setState({ activeTimer: null });
});

describe("app-store timer persistence", () => {
  it("startTimer persists to localStorage, clearTimer removes it", () => {
    useAppStore.getState().startTimer(1, 2, "Proj");
    const raw = localStorage.getItem("activeTimer");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ taskId: 1, projectId: 2, projectName: "Proj" });

    useAppStore.getState().clearTimer();
    expect(localStorage.getItem("activeTimer")).toBeNull();
    expect(useAppStore.getState().activeTimer).toBeNull();
  });

  it("restores a persisted timer on store init (app relaunch)", async () => {
    localStorage.setItem(
      "activeTimer",
      JSON.stringify({ taskId: 7, projectId: 3, startedAt: 1234, projectName: "P" })
    );
    vi.resetModules();
    const fresh = await import("../stores/app-store");
    expect(fresh.useAppStore.getState().activeTimer).toEqual({
      taskId: 7,
      projectId: 3,
      startedAt: 1234,
      projectName: "P",
    });
  });

  it("ignores a corrupted persisted timer", async () => {
    localStorage.setItem("activeTimer", "{not valid json");
    vi.resetModules();
    const fresh = await import("../stores/app-store");
    expect(fresh.useAppStore.getState().activeTimer).toBeNull();
  });
});

describe("stopAndSave", () => {
  it("writes the entry first and only then clears the timer", async () => {
    seedRunningTimer();
    vi.mocked(getTaskById).mockResolvedValue(mockTask);
    // Capture the timer state at write time to pin the ORDER: the entry
    // must be written while the timer is still set (clear happens after).
    let timerAtWriteTime: unknown = null;
    vi.mocked(createTimeEntry).mockImplementation(async () => {
      timerAtWriteTime = useAppStore.getState().activeTimer;
      return 1;
    });

    const { result } = renderHook(() => useTimerActions(), { wrapper });
    let saved = false;
    await act(async () => {
      saved = await result.current.stopAndSave();
    });

    expect(saved).toBe(true);
    expect(createTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 1, project_id: 2, duration_minutes: 5 })
    );
    expect(timerAtWriteTime).not.toBeNull();
    expect(useAppStore.getState().activeTimer).toBeNull();
    expect(localStorage.getItem("activeTimer")).toBeNull();
  });

  it("keeps the timer running (state + persistence) when the DB write fails", async () => {
    seedRunningTimer();
    vi.mocked(getTaskById).mockResolvedValue(mockTask);
    vi.mocked(createTimeEntry).mockRejectedValue(new Error("db down"));

    const { result } = renderHook(() => useTimerActions(), { wrapper });
    let saved = true;
    await act(async () => {
      saved = await result.current.stopAndSave();
    });

    expect(saved).toBe(false);
    expect(useAppStore.getState().activeTimer).not.toBeNull();
    expect(localStorage.getItem("activeTimer")).not.toBeNull();
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("saves with a null task_id when the task was deleted meanwhile", async () => {
    seedRunningTimer();
    vi.mocked(getTaskById).mockResolvedValue(null);
    vi.mocked(getProject).mockResolvedValue(mockProject);
    vi.mocked(createTimeEntry).mockResolvedValue(1);

    const { result } = renderHook(() => useTimerActions(), { wrapper });
    let saved = false;
    await act(async () => {
      saved = await result.current.stopAndSave();
    });

    expect(saved).toBe(true);
    expect(createTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: null, project_id: 2, duration_minutes: 5 })
    );
    expect(useAppStore.getState().activeTimer).toBeNull();
    expect(localStorage.getItem("activeTimer")).toBeNull();
  });

  it("discards the timer with a visible error when the project was deleted too", async () => {
    seedRunningTimer();
    vi.mocked(getTaskById).mockResolvedValue(null);
    vi.mocked(getProject).mockResolvedValue(null);

    const { result } = renderHook(() => useTimerActions(), { wrapper });
    let saved = true;
    await act(async () => {
      saved = await result.current.stopAndSave();
    });

    expect(saved).toBe(false);
    expect(createTimeEntry).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().activeTimer).toBeNull();
    expect(localStorage.getItem("activeTimer")).toBeNull();
  });

  it("toggleTimer does not overwrite an unsaved timer when saving fails", async () => {
    seedRunningTimer();
    vi.mocked(getTaskById).mockResolvedValue(mockTask);
    vi.mocked(createTimeEntry).mockRejectedValue(new Error("db down"));

    const { result } = renderHook(() => useTimerActions(), { wrapper });
    await act(async () => {
      // Different task: would normally stop current then start new
      await result.current.toggleTimer(99, 100, "Other");
    });

    const timer = useAppStore.getState().activeTimer;
    expect(timer?.taskId).toBe(1);
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});
