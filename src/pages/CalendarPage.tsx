import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { DateClickArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { X } from "lucide-react";
import { useT } from "../i18n/useT";
import { useTasksWithDueDate, useUpdateTask, useUpdateSubtask, useCreateTask, useCreateSubtask, useTasksByProject } from "../db/hooks/useTasks";
import { useProjects, useUpdateProject } from "../db/hooks/useProjects";
import { useAppStore } from "../stores/app-store";
import { ProjectDetailContent } from "../components/ProjectDetailContent";
import { getSubtasksWithDueDate } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { effectivePriority } from "../types/task";

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toDateStr(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/** FullCalendar all-day end is exclusive — return the day after the given date string */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

function extractEventData(event: EventDropArg["event"]) {
  const start = event.start;
  const end = event.end;
  const allDay = event.allDay;
  const date = start ? toDateStr(start) : null;
  const startTime = !allDay && start ? `${pad2(start.getHours())}:${pad2(start.getMinutes())}` : null;
  const endTime = !allDay && end ? `${pad2(end.getHours())}:${pad2(end.getMinutes())}` : null;
  // For multi-day all-day events, FullCalendar end is exclusive — subtract one day
  let endDate: string | null = null;
  if (allDay && end && start) {
    const endD = new Date(end.getTime());
    endD.setDate(endD.getDate() - 1);
    const endStr = toDateStr(endD);
    endDate = endStr !== date ? endStr : null;
  } else if (!allDay && end && start) {
    const endStr = toDateStr(end);
    endDate = endStr !== date ? endStr : null;
  }
  return { due_date: date, end_date: endDate, start_time: startTime, end_time: endTime };
}

interface QuickCreateState {
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  pos: { top: number; left: number };
}

export function CalendarPage() {
  const t = useT();
  const { data: tasks } = useTasksWithDueDate();
  const { data: subtasks } = useQuery({ queryKey: ["subtasks", "with-due-date"], queryFn: getSubtasksWithDueDate });
  const { data: projects } = useProjects();
  const updateTask = useUpdateTask();
  const updateSubtask = useUpdateSubtask();
  const updateProject = useUpdateProject();
  const createTask = useCreateTask();
  const navigate = useNavigate();
  const projectOpenMode = useAppStore((s) => s.projectOpenMode);

  const [quickCreate, setQuickCreate] = useState<QuickCreateState | null>(null);
  const [peekId, setPeekId] = useState<number | null>(null);
  const lastClickRef = useRef<{ time: number; date: string }>({ time: 0, date: "" });

  const events = useMemo<EventInput[]>(() => {
    const items: EventInput[] = [];

    for (const t of tasks ?? []) {
      if (!t.due_date) continue;
      const projectName = projects?.find((p) => p.id === t.project_id)?.name ?? "";
      const prio = effectivePriority(t.priority, t.due_date, t.end_date);
      const prioClass = `fc-priority-${prio}`;
      if (t.start_time) {
        items.push({
          id: `t-${t.id}`,
          title: `${projectName}: ${t.title}`,
          start: `${t.due_date}T${t.start_time}`,
          end: t.end_time ? `${(t.end_date || t.due_date)}T${t.end_time}` : undefined,
          allDay: false,
          extendedProps: { type: "task", itemId: t.id, projectId: t.project_id, status: t.status, isSubtask: false },
          classNames: t.status === "done" ? ["fc-done"] : [prioClass],
        });
      } else {
        items.push({
          id: `t-${t.id}`,
          title: `${projectName}: ${t.title}`,
          start: t.due_date,
          end: t.end_date ? nextDay(t.end_date) : undefined,
          allDay: true,
          extendedProps: { type: "task", itemId: t.id, projectId: t.project_id, status: t.status, isSubtask: false },
          classNames: t.status === "done" ? ["fc-done"] : [prioClass],
        });
      }
    }

    for (const s of subtasks ?? []) {
      if (!s.due_date) continue;
      const parentProjectId = (s as { project_id?: number }).project_id;
      const projectName = parentProjectId ? projects?.find((p) => p.id === parentProjectId)?.name ?? "" : "";
      const prio = effectivePriority("low", s.due_date, s.end_date);
      const prioClass = `fc-priority-${prio}`;
      if (s.start_time) {
        items.push({
          id: `s-${s.id}`,
          title: `${projectName}: ${s.title}`,
          start: `${s.due_date}T${s.start_time}`,
          end: s.end_time ? `${(s.end_date || s.due_date)}T${s.end_time}` : undefined,
          allDay: false,
          extendedProps: { type: "subtask", itemId: s.id, projectId: parentProjectId, status: s.status, isSubtask: true },
          classNames: s.status === "done" ? ["fc-done"] : [prioClass],
        });
      } else {
        items.push({
          id: `s-${s.id}`,
          title: `${projectName}: ${s.title}`,
          start: s.due_date,
          end: s.end_date ? nextDay(s.end_date) : undefined,
          allDay: true,
          extendedProps: { type: "subtask", itemId: s.id, projectId: parentProjectId, status: s.status, isSubtask: true },
          classNames: s.status === "done" ? ["fc-done"] : [prioClass],
        });
      }
    }

    for (const p of projects ?? []) {
      if (!p.deadline) continue;
      items.push({
        id: `dl-${p.id}`,
        title: `Deadline: ${p.name}`,
        start: p.deadline,
        allDay: true,
        extendedProps: { type: "deadline", itemId: p.id, projectId: p.id, isDeadline: true },
        classNames: ["fc-deadline"],
      });
    }

    return items;
  }, [tasks, subtasks, projects]);

  const handleEventChange = useCallback((event: EventDropArg["event"]) => {
    const { type, itemId } = event.extendedProps;
    const data = extractEventData(event);
    if (type === "task") {
      updateTask.mutate({ id: itemId, data });
    } else if (type === "subtask") {
      updateSubtask.mutate({ id: itemId, data });
    } else if (type === "deadline") {
      updateProject.mutate({ id: itemId, data: { deadline: data.due_date } });
    }
  }, [updateTask, updateSubtask, updateProject]);

  const handleEventDrop = useCallback((info: EventDropArg) => {
    handleEventChange(info.event);
  }, [handleEventChange]);

  const handleEventResize = useCallback((info: EventResizeDoneArg) => {
    handleEventChange(info.event);
  }, [handleEventChange]);

  const handleEventClick = useCallback((info: { event: { extendedProps: Record<string, unknown> } }) => {
    const projectId = info.event.extendedProps.projectId as number | undefined;
    if (!projectId) return;
    if (projectOpenMode === "peek") {
      setPeekId(projectId);
    } else {
      navigate(`/projects/${projectId}`);
    }
  }, [navigate, projectOpenMode]);

  const handleDateClick = useCallback((info: DateClickArg) => {
    const d = info.date;
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const now = Date.now();
    const last = lastClickRef.current;

    if (now - last.time < 400 && last.date === dateStr) {
      // Double-click detected — open quick create
      lastClickRef.current = { time: 0, date: "" };

      const startTime = !info.allDay ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : null;
      const endHour = d.getHours() + 1;
      const endTime = !info.allDay ? `${pad2(endHour)}:${pad2(d.getMinutes())}` : null;

      const rect = info.dayEl.getBoundingClientRect();
      const top = info.jsEvent.clientY;
      let left = rect.left + rect.width / 2;
      if (left + 150 > window.innerWidth) left = window.innerWidth - 160;
      if (left < 160) left = 160;

      setQuickCreate({
        date: dateStr,
        startTime,
        endTime,
        allDay: info.allDay,
        pos: { top, left },
      });
    } else {
      lastClickRef.current = { time: now, date: dateStr };
    }
  }, []);

  const createSubtask = useCreateSubtask();

  const handleQuickCreate = useCallback((projectId: number, title: string, parentTaskId?: number) => {
    if (!quickCreate) return;
    if (parentTaskId) {
      createSubtask.mutate({
        task_id: parentTaskId,
        title,
        status: "todo",
        due_date: quickCreate.date,
        end_date: null,
        start_time: quickCreate.startTime,
        end_time: quickCreate.endTime,
        reminder: null,
        sort_order: 0,
      });
    } else {
      createTask.mutate({
        project_id: projectId,
        title,
        description: "",
        status: "todo",
        priority: "low",
        due_date: quickCreate.date,
        end_date: null,
        start_time: quickCreate.startTime,
        end_time: quickCreate.endTime,
        reminder: null,
        scheduled_start: null,
        scheduled_end: null,
        notes: "",
        sort_order: 0,
      });
    }
    setQuickCreate(null);
  }, [quickCreate, createTask, createSubtask]);

  const renderEventContent = useCallback((arg: EventContentArg) => {
    const { status, isSubtask, isDeadline } = arg.event.extendedProps;
    const done = status === "done";
    const wrap = !arg.event.allDay;
    return (
      <div className={`${wrap ? "whitespace-normal break-words" : "truncate"} text-[11px] leading-tight px-1 ${done ? "line-through opacity-60" : ""}`}>
        {isSubtask && <span className="opacity-60">↳ </span>}
        {isDeadline && <span className="font-semibold">!</span>}
        {arg.timeText && <span className="font-medium mr-1">{arg.timeText}</span>}
        <span>{arg.event.title}</span>
      </div>
    );
  }, []);

  const activeProjects = useMemo(
    () => projects?.filter((p) => p.status === "active") ?? [],
    [projects]
  );

  return (
    <div className="flex h-full">
      <div className={`min-w-0 ${peekId !== null ? "flex-1" : "w-full"}`}>
        <h1 className="text-xl font-semibold mb-6">{t.calendar}</h1>
        <div className="fc-studio">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek",
            }}
            events={events}
            editable
            droppable
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventClick={handleEventClick}
            eventContent={renderEventContent}
            dateClick={handleDateClick}
            firstDay={1}
            height="calc(100vh - 140px)"
            slotMinTime="06:00:00"
            slotMaxTime="22:00:00"
            nowIndicator
            eventDisplay="block"
            dayMaxEvents={false}
          />
        </div>

        {quickCreate && (
          <QuickCreatePopup
            pos={quickCreate.pos}
            date={quickCreate.date}
            startTime={quickCreate.startTime}
            projects={activeProjects}
            onSubmit={handleQuickCreate}
            onClose={() => setQuickCreate(null)}
          />
        )}
      </div>

      {peekId !== null && (
        <div className="w-1/2 shrink-0 border-l border-gray-200 ml-4 pl-4 overflow-y-auto h-[calc(100vh-6rem)]">
          <div className="flex items-center justify-between mb-4">
            <Link
              to={`/projects/${peekId}`}
              className="text-xs text-accent hover:underline"
            >
              {t.open_full_page}
            </Link>
            <button
              onClick={() => setPeekId(null)}
              className="text-muted hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </div>
          <ProjectDetailContent projectId={peekId} compact />
        </div>
      )}
    </div>
  );
}

function QuickCreatePopup({
  pos,
  date,
  startTime,
  projects,
  onSubmit,
  onClose,
}: {
  pos: { top: number; left: number };
  date: string;
  startTime: string | null;
  projects: { id: number; name: string }[];
  onSubmit: (projectId: number, title: string, parentTaskId?: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [projectId, setProjectId] = useState<number | "">(projects.length > 0 ? projects[0].id : "");
  const [selectedTask, setSelectedTask] = useState<{ id: number; title: string } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);

  const { data: projectTasks } = useTasksByProject(typeof projectId === "number" ? projectId : 0);

  const suggestions = projectTasks?.filter(
    (task) => task.status !== "done" && (!title || (task.title.toLowerCase().includes(title.toLowerCase()) && task.title !== title))
  ) ?? [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (selectedTask) subtaskRef.current?.focus();
  }, [selectedTask]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = () => {
    if (!projectId) return;
    if (selectedTask) {
      if (!subtaskTitle.trim()) return;
      onSubmit(projectId as number, subtaskTitle.trim(), selectedTask.id);
    } else {
      if (!title.trim()) return;
      onSubmit(projectId as number, title.trim());
    }
  };

  const handleSelectTask = (task: { id: number; title: string }) => {
    setSelectedTask(task);
    setTitle(task.title);
    setShowSuggestions(false);
    setSubtaskTitle("");
  };

  const handleClearTask = () => {
    setSelectedTask(null);
    setSubtaskTitle("");
    setTitle("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Position: clamp to viewport
  let top = pos.top + 8;
  const popoverH = selectedTask ? 220 : 180;
  if (top + popoverH > window.innerHeight) {
    top = pos.top - popoverH - 8;
  }
  let left = pos.left - 130;
  if (left < 8) left = 8;
  if (left + 260 > window.innerWidth) left = window.innerWidth - 268;

  const timeLabel = startTime ?? t.all_day;
  const canSubmit = selectedTask ? !!subtaskTitle.trim() && !!projectId : !!title.trim() && !!projectId;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-gray-50 border border-gray-100 rounded-lg shadow-lg p-3 w-[260px]"
      style={{ top, left }}
    >
      <div className="text-[11px] text-muted mb-2">
        {date} · {timeLabel}
      </div>
      <select
        value={projectId}
        onChange={(e) => {
          setProjectId(e.target.value ? Number(e.target.value) : "");
          setSelectedTask(null);
          setSubtaskTitle("");
          setTitle("");
        }}
        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs mb-2"
      >
        <option value="">{t.select_project}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* Task name with autocomplete */}
      <div className="relative mb-2">
        {selectedTask ? (
          <div className="flex items-center gap-1 border border-accent/30 bg-accent-light rounded-md px-2 py-1.5">
            <span className="text-xs flex-1 truncate">{selectedTask.title}</span>
            <button
              onClick={handleClearTask}
              className="text-muted hover:text-gray-900 text-xs shrink-0"
            >
              ✕
            </button>
          </div>
        ) : (
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !showSuggestions) handleSubmit();
              if (e.key === "Enter" && suggestions.length > 0 && showSuggestions) {
                handleSelectTask(suggestions[0]);
                e.preventDefault();
              }
            }}
            placeholder={t.new_task}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
          />
        )}
        {!selectedTask && showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 top-full left-0 right-0 mt-0.5 bg-gray-50 border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
            {suggestions.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleSelectTask(task)}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100 truncate"
              >
                {task.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Subtask name when existing task selected */}
      {selectedTask && (
        <input
          ref={subtaskRef}
          value={subtaskTitle}
          onChange={(e) => setSubtaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder={t.new_subtask}
          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs mb-2"
        />
      )}

      <div className="flex justify-end gap-1.5">
        <button
          onClick={onClose}
          className="px-2.5 py-1 text-xs border border-gray-200 rounded hover:bg-gray-100"
        >
          {t.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-2.5 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40"
        >
          {t.add}
        </button>
      </div>
    </div>,
    document.body
  );
}
