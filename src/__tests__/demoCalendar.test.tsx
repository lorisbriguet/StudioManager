import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/demoBuild", () => ({ isDemoBuild: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  invoke: vi.fn(async () => undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { isDemoBuild } from "../lib/demoBuild";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listWritableCalendars,
  purgeAllCalendarEvents,
  syncAllExisting,
  updateCalendarEvent,
} from "../lib/appleCalendar";
import { syncAllUpkeepEvents } from "../lib/upkeep/calendar";
import { notify } from "../lib/notify";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { todayLocalISO } from "../utils/localDate";
import { SettingsPage } from "../pages/SettingsPage";

/** Calendar commands Rust was asked to run. */
const calendarCalls = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => String(cmd).startsWith("calendar_"));

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  vi.mocked(isDemoBuild).mockReturnValue(true);
  // The saved name the demo data carries (the app's default).
  useAppStore.setState({ language: "EN", calendarName: "StudioManager", calendarSync: false });
  useOrgStore.getState().applyRegistry({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "Studio", createdAt: "", prefs: null }] });
  const today = todayLocalISO();
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("pragma_table_info")) return [{ name: "calendar_deadline_id" }];
    if (flat.includes("FROM tasks WHERE due_date")) {
      return [{ id: 1, title: "T1", due_date: today, start_time: null, end_time: null, project_id: 7 }];
    }
    if (flat.includes("SELECT id, name FROM projects")) return [{ id: 7, name: "Proj" }];
    if (flat.includes("SELECT calendar_event_id FROM tasks")) return [{ calendar_event_id: "real-uid-from-a-copy" }];
    return [];
  });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("demo calendar: nothing reaches Apple Calendar", () => {
  it("lists only the simulated calendar", async () => {
    expect(await listWritableCalendars()).toEqual(["Studio"]);
    expect(calendarCalls()).toEqual([]);
  });

  it("creates, updates and deletes without calling Rust", async () => {
    const uid = await createCalendarEvent({ title: "A", date: "2026-11-07" });
    expect(uid).toMatch(/^demo-/);
    const next = await updateCalendarEvent(uid, { title: "B", date: "2026-11-08" });
    expect(next).toMatch(/^demo-/);
    expect(next).not.toBe(uid);
    await deleteCalendarEvent(next);
    expect(calendarCalls()).toEqual([]);
  });

  it("purges and syncs everything without calling Rust", async () => {
    await purgeAllCalendarEvents();
    expect(await syncAllExisting()).toBe(1);
    await syncAllUpkeepEvents();
    expect(calendarCalls()).toEqual([]);
  });

  it("still calls Rust in the app build", async () => {
    vi.mocked(isDemoBuild).mockReturnValue(false);
    await listWritableCalendars().catch(() => {});
    expect(calendarCalls().map(([cmd]) => cmd)).toEqual(["calendar_list_writable"]);
  });
});

function renderCalendarSettings() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/settings?category=calendar"]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Settings › Calendar Sync in the demo", () => {
  it("shows the simulated calendar only, not the saved 'StudioManager'", () => {
    renderCalendarSettings();
    expect(screen.queryByText("StudioManager")).toBeNull();
    expect(screen.getAllByText("Studio").length).toBeGreaterThan(0);
  });

  it("says the sync is simulated, not 'synced to Apple Calendar'", async () => {
    const success = vi.spyOn(notify, "success").mockImplementation(() => undefined as never);
    renderCalendarSettings();
    fireEvent.click(screen.getByRole("switch", { name: /sync tasks to apple calendar/i }));
    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(success.mock.calls[0][0]).toBe("1 events synced (simulated)");
    expect(calendarCalls()).toEqual([]);
    success.mockRestore();
  });
});
