import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../db/index";
import { useAppStore } from "../stores/app-store";
import { logError, logInfo, logWarn } from "../lib/log";
import { notifyError, getLabels } from "../lib/notifyError";

function getCalendarName(): string {
  return useAppStore.getState().calendarName || "StudioManager";
}

// Calendar automation runs in Rust (`src-tauri/src/apple.rs`): fixed
// AppleScript sources with all user data passed as argv, so no script
// injection surface and no shell:allow-execute capability. Date/time
// validation happens on the Rust side.
async function invokeCalendar<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Calendar operation timed out after 10s")), 10000)
    ),
  ]);
}

/** List writable calendars from Apple Calendar */
export async function listWritableCalendars(): Promise<string[]> {
  return invokeCalendar<string[]>("calendar_list_writable");
}

interface CalendarEvent {
  title: string;
  date: string; // yyyy-MM-dd
  startTime?: string | null; // HH:mm
  endTime?: string | null; // HH:mm
  notes?: string;
}

/** Create an event in Apple Calendar and return its uid */
export async function createCalendarEvent(event: CalendarEvent): Promise<string> {
  return invokeCalendar<string>("calendar_create_event", {
    calendar: getCalendarName(),
    title: event.title,
    notes: event.notes ?? "",
    date: event.date,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
  });
}

/** Update an existing calendar event by uid — deletes old and creates new */
export async function updateCalendarEvent(uid: string, event: CalendarEvent): Promise<string> {
  try { await deleteCalendarEvent(uid); } catch (e) { logWarn("Calendar sync: delete old event:", e); }
  return await createCalendarEvent(event);
}

/** Delete a calendar event by uid */
export async function deleteCalendarEvent(uid: string): Promise<void> {
  await invokeCalendar<void>("calendar_delete_event", {
    calendar: getCalendarName(),
    uid,
  });
}

/** Delete all StudioManager-tracked events from the calendar and reset stored IDs */
export async function purgeAllCalendarEvents(): Promise<void> {
  const db = await getDb();

  // Collect all tracked UIDs from DB
  const uids: string[] = [];
  try {
    const tasks = await db.select<{ calendar_event_id: string }[]>(
      "SELECT calendar_event_id FROM tasks WHERE calendar_event_id IS NOT NULL AND calendar_event_id != ''"
    );
    uids.push(...tasks.map((t) => t.calendar_event_id));
  } catch (e) { logWarn("Calendar sync:", e); }
  try {
    const subtasks = await db.select<{ calendar_event_id: string }[]>(
      "SELECT calendar_event_id FROM subtasks WHERE calendar_event_id IS NOT NULL AND calendar_event_id != ''"
    );
    uids.push(...subtasks.map((s) => s.calendar_event_id));
  } catch (e) { logWarn("Calendar sync: fetch subtask UIDs:", e); }
  try {
    const projects = await db.select<{ calendar_deadline_id: string }[]>(
      "SELECT calendar_deadline_id FROM projects WHERE calendar_deadline_id IS NOT NULL AND calendar_deadline_id != ''"
    );
    uids.push(...projects.map((p) => p.calendar_deadline_id));
  } catch (e) { logWarn("Calendar sync: fetch project UIDs:", e); }

  // Delete each tracked event by UID
  for (const uid of uids) {
    try {
      await deleteCalendarEvent(uid);
    } catch (e) { logWarn("Calendar sync: delete event:", e); }
  }

  // Clear all stored calendar IDs in DB
  await db.execute("UPDATE tasks SET calendar_event_id = NULL WHERE calendar_event_id IS NOT NULL");
  await db.execute("UPDATE subtasks SET calendar_event_id = NULL WHERE calendar_event_id IS NOT NULL");
  try {
    await db.execute("UPDATE projects SET calendar_deadline_id = NULL WHERE calendar_deadline_id IS NOT NULL");
  } catch (e) { logWarn("Calendar sync: clear project deadline IDs:", e); }
}

/** Sync all existing tasks, subtasks, and project deadlines that don't have a calendar_event_id yet */
export async function syncAllExisting(): Promise<number> {
  logInfo("[CalendarSync] Starting sync...");
  const db = await getDb();
  let count = 0;
  // Collect failures and surface at most ONE summary toast per sync run
  let failed = 0;
  let firstError: unknown = null;
  const recordFailure = (e: unknown) => {
    failed++;
    if (firstError === null) firstError = e;
  };

  // Ensure calendar_deadline_id column exists
  try {
    const projCols = await db.select<{ name: string }[]>("SELECT name FROM pragma_table_info('projects')");
    if (!projCols.some((c) => c.name === "calendar_deadline_id")) {
      await db.execute("ALTER TABLE projects ADD COLUMN calendar_deadline_id TEXT DEFAULT NULL");
    }
  } catch (e) {
    logError("Failed to ensure calendar_deadline_id column:", e);
  }

  // Batched lookups: one project-name map and one task->project map, instead
  // of one query per task and two per subtask.
  let projectNames = new Map<number, string>();
  try {
    const rows = await db.select<{ id: number; name: string }[]>("SELECT id, name FROM projects");
    projectNames = new Map(rows.map((p) => [p.id, p.name]));
  } catch (e) { logWarn("Calendar sync: fetch project names:", e); }

  // Tasks with due_date but no calendar_event_id
  try {
    const tasks = await db.select<{ id: number; title: string; due_date: string; start_time: string | null; end_time: string | null; project_id: number }[]>(
      "SELECT id, title, due_date, start_time, end_time, project_id FROM tasks WHERE due_date IS NOT NULL AND status != 'done' AND (calendar_event_id IS NULL OR calendar_event_id = '')"
    );
    logInfo(`[CalendarSync] Found ${tasks.length} tasks to sync`);
    for (const t of tasks) {
      try {
        logInfo(`[CalendarSync] Syncing task ${t.id}: ${t.title}`);
        const projectName = projectNames.get(t.project_id) ?? "";
        const uid = await createCalendarEvent({
          title: `${projectName}: ${t.title}`,
          date: t.due_date,
          startTime: t.start_time,
          endTime: t.end_time,
        });
        await db.execute("UPDATE tasks SET calendar_event_id = $1 WHERE id = $2", [uid, t.id]);
        count++;
      } catch (e) {
        recordFailure(e);
        logError(`Failed to sync task ${t.id}:`, e);
      }
    }
  } catch (e) {
    recordFailure(e);
    logError("Failed to query tasks for sync:", e);
  }

  // Subtasks with due_date but no calendar_event_id
  try {
    const subtasks = await db.select<{ id: number; title: string; due_date: string; start_time: string | null; end_time: string | null; task_id: number }[]>(
      "SELECT id, title, due_date, start_time, end_time, task_id FROM subtasks WHERE due_date IS NOT NULL AND status != 'done' AND (calendar_event_id IS NULL OR calendar_event_id = '')"
    );
    const taskProjects = subtasks.length > 0
      ? new Map(
          (await db.select<{ id: number; project_id: number }[]>("SELECT id, project_id FROM tasks"))
            .map((r) => [r.id, r.project_id])
        )
      : new Map<number, number>();
    for (const s of subtasks) {
      try {
        const projectId = taskProjects.get(s.task_id);
        const projectName = projectId != null ? projectNames.get(projectId) ?? "" : "";
        const uid = await createCalendarEvent({
          title: `${projectName}: ${s.title}`,
          date: s.due_date,
          startTime: s.start_time,
          endTime: s.end_time,
        });
        await db.execute("UPDATE subtasks SET calendar_event_id = $1 WHERE id = $2", [uid, s.id]);
        count++;
      } catch (e) {
        recordFailure(e);
        logError(`Failed to sync subtask ${s.id}:`, e);
      }
    }
  } catch (e) {
    recordFailure(e);
    logError("Failed to query subtasks for sync:", e);
  }

  // Project deadlines
  try {
    const projects = await db.select<{ id: number; name: string; deadline: string }[]>(
      "SELECT id, name, deadline FROM projects WHERE deadline IS NOT NULL AND (calendar_deadline_id IS NULL OR calendar_deadline_id = '')"
    );
    for (const p of projects) {
      try {
        const uid = await createCalendarEvent({
          title: `${getLabels().deadline}: ${p.name}`,
          date: p.deadline,
        });
        await db.execute("UPDATE projects SET calendar_deadline_id = $1 WHERE id = $2", [uid, p.id]);
        count++;
      } catch (e) {
        recordFailure(e);
        logError(`Failed to sync deadline for project ${p.id}:`, e);
      }
    }
  } catch (e) {
    recordFailure(e);
    logError("Failed to query projects for sync:", e);
  }

  if (failed > 0) {
    notifyError(getLabels().calendar_sync_failed, firstError);
  }

  return count;
}
