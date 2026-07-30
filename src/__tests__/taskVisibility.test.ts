import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  getVisibleTasks,
  getTasksWithDueDate,
  getSubtasksWithDueDate,
  getAllTasks,
  getTasksByProject,
  getSubtasksByProject,
} from "../db/queries/tasks";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// V1.11 C1: cross-project task surfaces hide tasks of cancelled/completed
// projects at the query level; project-scoped queries stay unfiltered.

const VISIBLE_PREDICATE = "NOT IN ('cancelled', 'completed')";

/** Route select() through a capture so tests can assert the SQL sent. */
function captureSelects(): string[] {
  const seen: string[] = [];
  setSelectHandler((sql) => {
    seen.push(sql.replace(/\s+/g, " "));
    return [];
  });
  return seen;
}

describe("task visibility (cancelled/completed projects)", () => {
  beforeAll(async () => {
    // Warm the DB singleton so ensureSchema noise doesn't pollute the capture
    await getDb();
  });

  beforeEach(() => {
    setSelectHandler(null);
  });

  it("getVisibleTasks joins projects and excludes cancelled/completed", async () => {
    const seen = captureSelects();
    await getVisibleTasks();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("JOIN projects p ON p.id = t.project_id");
    expect(seen[0]).toContain(VISIBLE_PREDICATE);
  });

  it("getTasksWithDueDate keeps the due-date filter and excludes cancelled/completed", async () => {
    const seen = captureSelects();
    await getTasksWithDueDate();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("JOIN projects p ON p.id = t.project_id");
    expect(seen[0]).toContain("t.due_date IS NOT NULL");
    expect(seen[0]).toContain(VISIBLE_PREDICATE);
  });

  it("getSubtasksWithDueDate reaches projects through tasks and excludes cancelled/completed", async () => {
    const seen = captureSelects();
    await getSubtasksWithDueDate();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("JOIN tasks t ON s.task_id = t.id");
    expect(seen[0]).toContain("JOIN projects p ON p.id = t.project_id");
    expect(seen[0]).toContain("s.due_date IS NOT NULL");
    expect(seen[0]).toContain(VISIBLE_PREDICATE);
  });

  it("project-scoped and raw queries stay unfiltered (ProjectDetail keeps its tasks)", async () => {
    const seen = captureSelects();
    await getTasksByProject(7);
    await getSubtasksByProject(7);
    await getAllTasks();
    expect(seen).toHaveLength(3);
    for (const sql of seen) {
      expect(sql).not.toContain("cancelled");
      expect(sql).not.toContain("p.status");
    }
  });
});
