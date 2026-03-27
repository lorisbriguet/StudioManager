import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X, Eye, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useProjects, useCreateProject, useDeleteProject } from "../db/hooks/useProjects";
import { useClients } from "../db/hooks/useClients";
import { useAllTasks } from "../db/hooks/useTasks";
import { getAllSubtasks } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import type { Subtask } from "../types/task";
import { useAppStore } from "../stores/app-store";
import { useTabStore } from "../stores/tab-store";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { formatDisplayDate } from "../utils/formatDate";
import { ProjectDetailContent } from "../components/ProjectDetailContent";
import type { ProjectStatus } from "../types/project";
import { effectivePriority, type TaskPriority } from "../types/task";
import { useT } from "../i18n/useT";
import type { UIKey } from "../i18n/ui";
import { Button, Badge, Card, PageHeader, SearchBar, PageSpinner, Input } from "../components/ui";

type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "accent" | "info";

const statusBadgeVariant: Record<ProjectStatus, BadgeVariant> = {
  active: "accent",
  completed: "success",
  on_hold: "warning",
  cancelled: "neutral",
};

const statusKeys: Record<ProjectStatus, UIKey> = {
  active: "active",
  completed: "completed",
  on_hold: "on_hold",
  cancelled: "cancelled",
};

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { data: clients } = useClients();
  const { data: allTasks } = useAllTasks();
  const { data: allSubtasks } = useQuery({ queryKey: ["subtasks"], queryFn: getAllSubtasks });
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const projectOpenMode = useAppStore((s) => s.projectOpenMode);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<{ id: number; name: string }> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<ProjectStatus | "all">("active");
  const [search, setSearch] = useState("");
  const [peekId, setPeekId] = useState<number | null>(null);
  const [closingPeek, setClosingPeek] = useState(false);
  const t = useT();

  const clientName = (clientId: string) =>
    clients?.find((c) => c.id === clientId)?.name ?? clientId;

  const priorityRank: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };

  // Group subtasks by task_id
  const subtasksByTask = useMemo(() => {
    const map: Record<number, Subtask[]> = {};
    for (const s of allSubtasks ?? []) {
      (map[s.task_id] ??= []).push(s);
    }
    return map;
  }, [allSubtasks]);

  const taskStats = useMemo(() => {
    const map: Record<number, { total: number; pct: number; maxPriority: TaskPriority }> = {};
    // Group tasks by project
    const byProject: Record<number, typeof allTasks> = {};
    for (const tk of allTasks ?? []) {
      (byProject[tk.project_id] ??= []).push(tk);
      if (!map[tk.project_id]) map[tk.project_id] = { total: 0, pct: 0, maxPriority: "low" };
      map[tk.project_id].total++;
      if (tk.status !== "done") {
        const eff = effectivePriority(tk.priority, tk.due_date, tk.end_date);
        if (priorityRank[eff] > priorityRank[map[tk.project_id].maxPriority]) {
          map[tk.project_id].maxPriority = eff;
        }
      }
    }
    // Compute weighted progress per project
    for (const [pid, tasks] of Object.entries(byProject)) {
      const projectId = Number(pid);
      if (!tasks || tasks.length === 0) continue;
      const weight = 1 / tasks.length;
      let sum = 0;
      for (const tk of tasks) {
        const subs = subtasksByTask[tk.id];
        if (!subs || subs.length === 0) {
          if (tk.status === "done") sum += weight;
        } else {
          const doneSubs = subs.filter((s) => s.status === "done").length;
          sum += weight * (doneSubs / subs.length);
        }
      }
      map[projectId].pct = Math.round(sum * 100);
    }
    return map;
  }, [allTasks, subtasksByTask]);

  const filtered = useMemo(() => {
    let rows = projects ?? [];
    if (filter !== "all") rows = rows.filter((p) => p.status === filter);
    const q = search.toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          clientName(p.client_id).toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      const pa = priorityRank[taskStats[a.id]?.maxPriority ?? "low"];
      const pb = priorityRank[taskStats[b.id]?.maxPriority ?? "low"];
      return pb - pa;
    });
  }, [projects, clients, filter, search, taskStats]);

  const handleProjectClick = (projectId: number) => {
    if (projectOpenMode === "peek") {
      setClosingPeek(false);
      setPeekId(projectId);
    } else {
      navigate(`/projects/${projectId}`);
    }
  };

  const handleClosePeek = () => {
    setClosingPeek(true);
  };

  const filterLabels: Record<ProjectStatus | "all", string> = {
    all: t.all,
    active: t.active,
    completed: t.completed,
    on_hold: t.on_hold,
    cancelled: t.cancelled,
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div className="flex flex-1 min-h-0">
      <div className="min-w-0 overflow-y-auto flex-1">
        <PageHeader title={t.projects}>
          <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>{t.new_project}</Button>
        </PageHeader>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex flex-wrap gap-2">
            {(["all", "active", "completed", "on_hold", "cancelled"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1 text-xs rounded-full border ${
                  filter === s
                    ? "bg-accent text-white border-accent"
                    : "border-gray-200 text-muted hover:bg-gray-50 dark:hover:bg-gray-200"
                }`}
              >
                {filterLabels[s]}
              </button>
            ))}
          </div>
          <SearchBar value={search} onChange={setSearch} placeholder={t.search_projects} className="w-48" />
        </div>

        {showForm && (
          <NewProjectForm
            clients={clients ?? []}
            onSave={(data) => {
              createProject.mutate(data, {
                onSuccess: () => {
                  toast.success(t.toast_project_created);
                  setShowForm(false);
                },
              });
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {filtered.map((p) => {
            const stats = taskStats[p.id] ?? { total: 0, pct: 0, maxPriority: "low" as TaskPriority };
            const pct = stats.pct;

            return (
              <div
                key={p.id}
                onClick={() => handleProjectClick(p.id)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: { id: p.id, name: p.name } }); }}
                className={`block border rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer ${
                  peekId === p.id
                    ? "border-accent bg-accent-light/30"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-medium leading-tight">{p.name}</h3>
                  <Badge variant={statusBadgeVariant[p.status]} className="shrink-0 ml-2">
                    {t[statusKeys[p.status]]}
                  </Badge>
                </div>

                <div className="text-xs text-muted mb-3">{clientName(p.client_id)}</div>

                {stats.total > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-[11px] text-muted mb-1">
                      <span>{stats.total} {t.tasks.toLowerCase()}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
                {stats.total === 0 && (
                  <div className="text-[11px] text-muted mb-3">{t.no_tasks}</div>
                )}

                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>{p.deadline ? formatDisplayDate(p.deadline) : t.no_deadline}</span>
                  {stats.total > 0 && stats.maxPriority !== "low" && (
                    <span className={stats.maxPriority === "high" ? "text-red-600" : "text-yellow-600"}>
                      {stats.maxPriority === "high" ? "!!!" : "!!"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-sm text-muted py-8 text-center">
              {search ? t.no_matching_projects : t.no_projects}
            </div>
          )}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.view_details, icon: <Eye size={14} />, onClick: () => navigate(`/projects/${ctxMenu.item.id}`) },
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/projects/${ctxMenu.item.id}`, ctxMenu.item.name) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteProject.mutate(ctxMenu.item.id) },
          ]}
        />
      )}

      {/* Side Peek Panel */}
      {peekId !== null && (
        <div
          className={`shrink-0 border-l border-gray-200 overflow-y-auto ${closingPeek ? "peek-exit" : "peek-enter"}`}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={() => { if (closingPeek) { setPeekId(null); setClosingPeek(false); } }}
        >
          <div className="flex items-center justify-between mb-4">
            <Link
              to={`/projects/${peekId}`}
              className="text-xs text-accent hover:underline"
            >
              {t.open_full_page}
            </Link>
            <button
              onClick={handleClosePeek}
              className="text-muted hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </div>
          <ProjectDetailContent key={peekId} projectId={peekId} compact />
        </div>
      )}
    </div>
  );
}

function NewProjectForm({
  clients,
  onSave,
  onCancel,
}: {
  clients: { id: string; name: string }[];
  onSave: (data: {
    client_id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    start_date: string | null;
    deadline: string | null;
    notes: string;
    layout_config: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    client_id: clients[0]?.id ?? "",
    name: "",
    description: "",
    status: "active" as ProjectStatus,
    start_date: "",
    deadline: "",
    notes: "",
  });
  const t = useT();

  return (
    <Card className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          placeholder={`${t.project_name} *`}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          value={form.client_id}
          onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          className="border border-gray-200 dark:border-gray-600 rounded-md px-3 py-1.5 text-sm"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
        />
        <Input
          type="date"
          value={form.deadline}
          onChange={(e) => setForm({ ...form, deadline: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (!form.name.trim()) return toast.error(t.toast_name_required);
            if (!form.client_id) return toast.error(t.toast_select_client);
            onSave({
              ...form,
              start_date: form.start_date || null,
              deadline: form.deadline || null,
              layout_config: null,
            });
          }}
        >
          {t.save}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </Card>
  );
}
