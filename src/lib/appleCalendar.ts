import { Command } from "@tauri-apps/plugin-shell";
import { getDb } from "../db/index";
import { useAppStore } from "../stores/app-store";
import { logError, logInfo, logWarn } from "../lib/log";

function getCalendarName(): string {
  return useAppStore.getState().calendarName || "StudioManager";
}

async function runAppleScript(script: string): Promise<string> {
  const cmd = Command.create("osascript", ["-e", script]);
  const result = await Promise.race([
    cmd.execute(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("osascript timed out after 10s")), 10000)
    ),
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `osascript failed with code ${result.code}`);
  }
  return result.stdout.trim();
}

/** List writable calendars from Apple Calendar */
export async function listWritableCalendars(): Promise<string[]> {
  const raw = await runAppleScript(`
    tell application "Calendar"
      set output to ""
      repeat with c in every calendar
        if writable of c then
          set output to output & name of c & "||"
        end if
      end repeat
      return output
    end tell
  `);
  if (!raw) return [];
  return raw.split("||").filter((n) => n.length > 0);
}

function escapeAS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    // Strip characters that could break AppleScript string boundaries
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // control chars except \t \n \r
}

/** Validate date string is yyyy-MM-dd format and return parsed parts, or throw */
function parseDateParts(date: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`);
  }
  return {
    year: parseInt(date.slice(0, 4)),
    month: parseInt(date.slice(5, 7)),
    day: parseInt(date.slice(8, 10)),
  };
}

/** Validate time string is HH:mm format and return parsed parts, or throw */
function parseTimeParts(time: string): { hours: number; minutes: number } {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Invalid time format: ${time}`);
  }
  return {
    hours: parseInt(time.split(":")[0]),
    minutes: parseInt(time.split(":")[1]),
  };
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
  const calName = escapeAS(getCalendarName());
  const title = escapeAS(event.title);
  const notes = escapeAS(event.notes ?? "");
  const d = parseDateParts(event.date);

  let script: string;
  if (event.startTime) {
    const st = parseTimeParts(event.startTime);
    const et = parseTimeParts(event.endTime ?? event.startTime);
    // Compute duration in seconds; minimum 1 hour if start == end
    let durationSecs = (et.hours - st.hours) * 3600 + (et.minutes - st.minutes) * 60;
    if (durationSecs <= 0) durationSecs = 3600;
    script = `
      tell application "Calendar"
        tell calendar "${calName}"
          set startDate to current date
          set hours of startDate to 0
          set minutes of startDate to 0
          set seconds of startDate to 0
          set year of startDate to ${d.year}
          set month of startDate to ${d.month}
          set day of startDate to ${d.day}
          set hours of startDate to ${st.hours}
          set minutes of startDate to ${st.minutes}
          set endDate to startDate + ${durationSecs}
          set newEvent to make new event with properties {summary:"${title}", start date:startDate, end date:endDate, description:"${notes}"}
          return uid of newEvent
        end tell
      end tell
    `;
  } else {
    script = `
      tell application "Calendar"
        tell calendar "${calName}"
          set eventDate to current date
          set year of eventDate to ${d.year}
          set month of eventDate to ${d.month}
          set day of eventDate to ${d.day}
          set hours of eventDate to 0
          set minutes of eventDate to 0
          set seconds of eventDate to 0
          set newEvent to make new event with properties {summary:"${title}", start date:eventDate, end date:eventDate, allday event:true, description:"${notes}"}
          return uid of newEvent
        end tell
      end tell
    `;
  }

  return await runAppleScript(script);
}

/** Update an existing calendar event by uid — deletes old and creates new */
export async function updateCalendarEvent(uid: string, event: CalendarEvent): Promise<string> {
  try { await deleteCalendarEvent(uid); } catch (e) { logWarn("Calendar sync: delete old event:", e); }
  return await createCalendarEvent(event);
}

/** Delete a calendar event by uid */
export async function deleteCalendarEvent(uid: string): Promise<void> {
  const calName = escapeAS(getCalendarName());
  const safeUid = escapeAS(uid);
  await runAppleScript(`
    tell application "Calendar"
      tell calendar "${calName}"
        set theEvents to (every event whose uid is "${safeUid}")
        repeat with e in theEvents
          delete e
        end repeat
      end tell
    end tell
  `);
}

/** Delete all StudioManager-tracked events from the calendar and reset stored IDs */
export async function purgeAllCalendarEvents(): Promise<void> {
  const db = await getDb();
  const calName = escapeAS(getCalendarName());

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
      const safeUid = escapeAS(uid);
      await runAppleScript(`
        tell application "Calendar"
          tell calendar "${calName}"
            set theEvents to (every event whose uid is "${safeUid}")
            repeat with e in theEvents
              delete e
            end repeat
          end tell
        end tell
      `);
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

  // Ensure calendar_deadline_id column exists
  try {
    const projCols = await db.select<{ name: string }[]>("SELECT name FROM pragma_table_info('projects')");
    if (!projCols.some((c) => c.name === "calendar_deadline_id")) {
      await db.execute("ALTER TABLE projects ADD COLUMN calendar_deadline_id TEXT DEFAULT NULL");
    }
  } catch (e) {
    logError("Failed to ensure calendar_deadline_id column:", e);
  }

  // Tasks with due_date but no calendar_event_id
  try {
    const tasks = await db.select<{ id: number; title: string; due_date: string; start_time: string | null; end_time: string | null; project_id: number }[]>(
      "SELECT id, title, due_date, start_time, end_time, project_id FROM tasks WHERE due_date IS NOT NULL AND status != 'done' AND (calendar_event_id IS NULL OR calendar_event_id = '')"
    );
    logInfo(`[CalendarSync] Found ${tasks.length} tasks to sync`);
    for (const t of tasks) {
      try {
        logInfo(`[CalendarSync] Syncing task ${t.id}: ${t.title}`);
        const pRows = await db.select<{ name: string }[]>("SELECT name FROM projects WHERE id = $1", [t.project_id]);
        const projectName = pRows[0]?.name ?? "";
        const uid = await createCalendarEvent({
          title: `${projectName}: ${t.title}`,
          date: t.due_date,
          startTime: t.start_time,
          endTime: t.end_time,
        });
        await db.execute("UPDATE tasks SET calendar_event_id = $1 WHERE id = $2", [uid, t.id]);
        count++;
      } catch (e) {
        logError(`Failed to sync task ${t.id}:`, e);
      }
    }
  } catch (e) {
    logError("Failed to query tasks for sync:", e);
  }

  // Subtasks with due_date but no calendar_event_id
  try {
    const subtasks = await db.select<{ id: number; title: string; due_date: string; start_time: string | null; end_time: string | null; task_id: number }[]>(
      "SELECT id, title, due_date, start_time, end_time, task_id FROM subtasks WHERE due_date IS NOT NULL AND status != 'done' AND (calendar_event_id IS NULL OR calendar_event_id = '')"
    );
    for (const s of subtasks) {
      try {
        const tRows = await db.select<{ project_id: number }[]>("SELECT project_id FROM tasks WHERE id = $1", [s.task_id]);
        const projectId = tRows[0]?.project_id;
        const pRows = projectId ? await db.select<{ name: string }[]>("SELECT name FROM projects WHERE id = $1", [projectId]) : [];
        const projectName = pRows[0]?.name ?? "";
        const uid = await createCalendarEvent({
          title: `${projectName}: ${s.title}`,
          date: s.due_date,
          startTime: s.start_time,
          endTime: s.end_time,
        });
        await db.execute("UPDATE subtasks SET calendar_event_id = $1 WHERE id = $2", [uid, s.id]);
        count++;
      } catch (e) {
        logError(`Failed to sync subtask ${s.id}:`, e);
      }
    }
  } catch (e) {
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
          title: `Deadline: ${p.name}`,
          date: p.deadline,
        });
        await db.execute("UPDATE projects SET calendar_deadline_id = $1 WHERE id = $2", [uid, p.id]);
        count++;
      } catch (e) {
        logError(`Failed to sync deadline for project ${p.id}:`, e);
      }
    }
  } catch (e) {
    logError("Failed to query projects for sync:", e);
  }

  return count;
}
