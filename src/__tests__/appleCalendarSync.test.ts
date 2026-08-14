import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { syncAllExisting } from "../lib/appleCalendar";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { todayLocalISO } from "../utils/localDate";

// Calendar sync used one project lookup PER task and TWO lookups per
// subtask (task -> project). It must batch-fetch instead.

describe("syncAllExisting query batching", () => {
  let seen: string[];

  beforeAll(async () => {
    await getDb();
  });

  beforeEach(() => {
    useAppStore.setState({ language: "EN", calendarName: "TestCal" });
    seen = [];
    const today = todayLocalISO();
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      seen.push(flat);
      if (flat.includes("pragma_table_info")) return [{ name: "calendar_deadline_id" }];
      if (flat.includes("FROM tasks WHERE due_date")) {
        return [
          { id: 1, title: "T1", due_date: today, start_time: null, end_time: null, project_id: 7 },
          { id: 2, title: "T2", due_date: today, start_time: null, end_time: null, project_id: 7 },
        ];
      }
      if (flat.includes("FROM subtasks WHERE due_date")) {
        return [
          { id: 9, title: "S1", due_date: today, start_time: null, end_time: null, task_id: 1 },
        ];
      }
      if (flat.includes("SELECT id, name FROM projects")) return [{ id: 7, name: "Proj" }];
      if (flat.includes("SELECT id, project_id FROM tasks")) return [{ id: 1, project_id: 7 }];
      // Legacy per-row lookups — return sane data so the old code still works
      if (flat.includes("FROM projects WHERE id")) return [{ name: "Proj" }];
      if (flat.includes("SELECT project_id FROM tasks WHERE id")) return [{ project_id: 7 }];
      return [];
    });
  });

  afterEach(() => {
    setSelectHandler(null);
  });

  it("resolves project names without per-row lookups", async () => {
    const count = await syncAllExisting();
    expect(count).toBe(3); // 2 tasks + 1 subtask

    const perRowProjectLookups = seen.filter((s) => s.includes("FROM projects WHERE id"));
    const perRowTaskLookups = seen.filter((s) =>
      s.includes("SELECT project_id FROM tasks WHERE id")
    );
    expect(perRowProjectLookups).toHaveLength(0);
    expect(perRowTaskLookups).toHaveLength(0);
  });
});
