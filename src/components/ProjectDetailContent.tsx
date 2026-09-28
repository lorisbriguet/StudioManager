import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useProject, useUpdateProject } from "../db/hooks/useProjects";
import { useClient } from "../db/hooks/useClients";
import { useTasksByProject, useSubtasksByProject } from "../db/hooks/useTasks";
import { WorkloadTable } from "./workload/WorkloadTable";
import { ProjectBlockLayout } from "./ProjectBlockLayout";
import type { BlockType } from "../types/project";
import { WorkloadColumnEditor } from "./workload/WorkloadColumnEditor";
import {
  useProjectWorkloadConfig,
  useSetProjectWorkloadConfig,
} from "../db/hooks/useWorkload";
import type { WorkloadColumn } from "../types/workload";
import { DEFAULT_WORKLOAD_COLUMNS } from "../types/workload";
import type { ProjectStatus } from "../types/project";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { useInvoices, useInvoicesByProject, useUpdateInvoice } from "../db/hooks/useInvoices";
import { useQuotes, useQuotesByProject, useUpdateQuote } from "../db/hooks/useQuotes";
import { Badge, Button, PageSpinner } from "./ui";
import { invoiceStatusVariant, quoteStatusVariant } from "../lib/statusColors";
import { useTabStore } from "../stores/tab-store";
import { open as openDirectory } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../i18n/useT";
import { ProjectResources } from "./project/ProjectResources";
import { ProjectWikiBlock } from "./project/ProjectWikiBlock";
import { ProjectTasksSection } from "./project/ProjectTasksSection";
import { ProjectNamedTables } from "./project/ProjectNamedTables";

interface Props {
  projectId: number;
  compact?: boolean;
}

export function ProjectDetailContent({ projectId, compact }: Props) {
  const { data: project, isLoading } = useProject(projectId);
  const { data: client } = useClient(project?.client_id ?? "");
  const { data: tasks } = useTasksByProject(projectId);
  const updateProject = useUpdateProject();
  const { data: allSubtasks } = useSubtasksByProject(projectId);

  const [status, setStatus] = useState<ProjectStatus>("active");
  const [sectionCtxMenu, setSectionCtxMenu] = useState<ContextMenuState<string> | null>(null);
  const openTab = useTabStore((s) => s.openTab);
  const [editingColumn, setEditingColumn] = useState<{
    column: WorkloadColumn | null;
    index: number;
  } | null>(null);
  const { data: wlConfig } = useProjectWorkloadConfig(projectId);
  const setWlConfig = useSetProjectWorkloadConfig(projectId);
  const t = useT();

  const { data: projectInvoices } = useInvoicesByProject(projectId);
  const { data: projectQuotes } = useQuotesByProject(projectId);
  const { data: allInvoices } = useInvoices();
  const { data: allQuotes } = useQuotes();
  const updateInvoice = useUpdateInvoice();
  const updateQuote = useUpdateQuote();
  const navigate = useNavigate();

  // Unassigned invoices/quotes for this client (no project_id or different project)
  const unlinkedInvoices = useMemo(() =>
    (allInvoices ?? []).filter((inv) => inv.client_id === project?.client_id && inv.project_id == null),
    [allInvoices, project?.client_id]
  );
  const unlinkedQuotes = useMemo(() =>
    (allQuotes ?? []).filter((qt) => qt.client_id === project?.client_id && qt.project_id == null),
    [allQuotes, project?.client_id]
  );

  const wlColumns = wlConfig?.columns ?? DEFAULT_WORKLOAD_COLUMNS;
  const wlTemplateId = wlConfig?.template_id ?? null;

  const handleSaveColumn = useCallback(
    (col: WorkloadColumn) => {
      let next = [...wlColumns];
      if (editingColumn && editingColumn.column) {
        // Editing existing
        next[editingColumn.index] = col;
      } else {
        // Adding new
        next.push(col);
      }
      // Only one column can be the calendar color source — clear others
      if (col.calendarColor) {
        next = next.map((c) =>
          c.key === col.key ? c : { ...c, calendarColor: false }
        );
      }
      setWlConfig.mutate({ templateId: wlTemplateId, columns: next });
    },
    [wlColumns, wlTemplateId, editingColumn, setWlConfig]
  );

  const handleDeleteColumn = useCallback(() => {
    if (editingColumn === null) return;
    const next = wlColumns.filter((_, i) => i !== editingColumn.index);
    setWlConfig.mutate({ templateId: wlTemplateId, columns: next });
  }, [wlColumns, wlTemplateId, editingColumn, setWlConfig]);

  useEffect(() => {
    if (project) setStatus(project.status);
  }, [project]);

  if (isLoading) return <PageSpinner />;
  if (!project) return <div className="text-muted text-sm">{t.no_projects}</div>;

  const totalCount = tasks?.length ?? 0;
  // Weighted progress: each task = 1/totalTasks weight, subdivided by subtasks
  const progress = (() => {
    if (!tasks || tasks.length === 0) return 0;
    const weight = 1 / tasks.length;
    let sum = 0;
    for (const tk of tasks) {
      const subs = allSubtasks?.filter((s) => s.task_id === tk.id) ?? [];
      if (subs.length === 0) {
        if (tk.status === "done") sum += weight;
      } else {
        const doneSubs = subs.filter((s) => s.status === "done").length;
        sum += weight * (doneSubs / subs.length);
      }
    }
    return Math.round(sum * 100);
  })();

  const renderBlock = (type: BlockType): React.ReactNode => {
    switch (type) {
      case "notes":
        return (
          <div>
            <textarea
              placeholder={t.notes}
              defaultValue={project.notes ?? ""}
              onBlur={(e) => {
                const val = e.target.value;
                if (val !== (project.notes ?? "")) {
                  updateProject.mutate({ id: projectId, data: { notes: val } });
                }
              }}
              className="w-full border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-3 py-2 text-sm resize-vertical min-h-[60px] max-h-[60vh] placeholder:text-muted"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
          </div>
        );
      case "tasks":
        return <ProjectTasksSection projectId={projectId} project={project} tasks={tasks ?? []} allSubtasks={allSubtasks ?? []} compact={compact} />;
      case "workload":
        return (
          <>
            <WorkloadTable
              projectId={projectId}
              onEditColumn={(col, idx) => setEditingColumn({ column: col, index: idx })}
            />
            {editingColumn !== null && createPortal(
              <WorkloadColumnEditor
                column={editingColumn.column}
                existingKeys={wlColumns.map((c) => c.key)}
                onSave={handleSaveColumn}
                onDelete={editingColumn.column ? handleDeleteColumn : undefined}
                onClose={() => setEditingColumn(null)}
              />,
              document.body
            )}
          </>
        );
      case "resources":
        return <ProjectResources projectId={projectId} />;
      case "named_tables":
        return <ProjectNamedTables projectId={projectId} />;
      case "invoices":
        return (
          <div className="text-sm">
            {(!projectInvoices || projectInvoices.length === 0) ? (
              <div className="text-muted">{t.no_invoices_yet}</div>
            ) : (
              <div className="divide-y divide-[var(--color-border-divider)]">
                {projectInvoices.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => navigate(`/invoices/${inv.id}/preview`)}
                    className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-[var(--color-hover-row)] rounded-md px-1 transition-colors"
                  >
                    <span className="text-sm truncate">{inv.reference}</span>
                    <span className="text-xs text-muted">{inv.total.toFixed(2)} {inv.currency ?? "CHF"}</span>
                    <Badge variant={invoiceStatusVariant(inv.status)} className="ml-auto">{inv.status}</Badge>
                  </button>
                ))}
              </div>
            )}
            {unlinkedInvoices.length > 0 && (
              <div className="mt-2">
                <select
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id) updateInvoice.mutate({ id, data: { project_id: projectId } });
                  }}
                  className="text-xs border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-2 py-1 w-full"
                >
                  <option value="">{t.link_invoice}</option>
                  {unlinkedInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.reference.startsWith("DRAFT") ? t.draft : inv.reference} — {inv.total.toFixed(2)} CHF
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      case "quotes":
        return (
          <div className="text-sm">
            {(!projectQuotes || projectQuotes.length === 0) ? (
              <div className="text-muted">{t.no_quotes_yet}</div>
            ) : (
              <div className="divide-y divide-[var(--color-border-divider)]">
                {projectQuotes.map((qt) => (
                  <button
                    key={qt.id}
                    onClick={() => navigate(`/quotes/${qt.id}/preview`)}
                    className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-[var(--color-hover-row)] rounded-md px-1 transition-colors"
                  >
                    <span className="text-sm truncate">{qt.reference}</span>
                    <span className="text-xs text-muted">{qt.total.toFixed(2)}</span>
                    <Badge variant={quoteStatusVariant(qt.status)} className="ml-auto">{qt.status}</Badge>
                  </button>
                ))}
              </div>
            )}
            {unlinkedQuotes.length > 0 && (
              <div className="mt-2">
                <select
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id) updateQuote.mutate({ id, data: { project_id: projectId } });
                  }}
                  className="text-xs border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-2 py-1 w-full"
                >
                  <option value="">{t.link_quote}</option>
                  {unlinkedQuotes.map((qt) => (
                    <option key={qt.id} value={qt.id}>
                      {qt.reference.startsWith("DRAFT") ? t.draft : qt.reference} — {qt.total.toFixed(2)} CHF
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      case "wiki":
        return <ProjectWikiBlock projectId={projectId} />;
      default:
        return null;
    }
  };

  return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className={compact ? "text-base font-semibold tracking-tight" : "text-xl font-semibold tracking-tight"}>
              {project.name}
            </h2>
            {client && (
              <Link to={`/clients/${client.id}`} className="text-xs text-muted hover:text-accent">
                {client.name}
              </Link>
            )}
          </div>
          <select
            value={status}
            onChange={(e) => {
              const v = e.target.value as ProjectStatus;
              setStatus(v);
              updateProject.mutate(
                { id: projectId, data: { status: v } },
                { onSuccess: () => toast.success(t.toast_status_updated) }
              );
            }}
            className="border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-2 py-1 text-xs"
          >
            <option value="active">{t.active}</option>
            <option value="completed">{t.completed}</option>
            <option value="on_hold">{t.on_hold}</option>
            <option value="cancelled">{t.cancelled}</option>
          </select>
        </div>

        <div className="flex items-center gap-4 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted">{t.start}</span>
            <input
              type="date"
              value={project.start_date ?? ""}
              onChange={(e) =>
                updateProject.mutate({
                  id: projectId,
                  data: { start_date: e.target.value || null },
                })
              }
              className="bg-transparent border-none text-xs text-muted cursor-pointer hover:text-[var(--color-text-secondary)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted">{t.deadline}</span>
            <input
              type="date"
              value={project.deadline ?? ""}
              onChange={(e) =>
                updateProject.mutate({
                  id: projectId,
                  data: { deadline: e.target.value || null },
                })
              }
              className="bg-transparent border-none text-xs text-muted cursor-pointer hover:text-[var(--color-text-secondary)]"
            />
          </div>
          {project.folder_path ? (
            <Button
              variant="link"
              size="sm"
              icon={<FolderOpen size={12} />}
              onClick={() => invoke("open_in_finder", { path: project.folder_path! }).catch(() => toast.error(t.failed_open_folder))}
              className="text-muted hover:text-[var(--color-text-secondary)] cursor-pointer"
            >
              {t.folder}
            </Button>
          ) : (
            <Button
              variant="link"
              size="sm"
              icon={<FolderOpen size={12} />}
              onClick={async () => {
                const dir = await openDirectory({ directory: true, title: t.set_folder });
                if (typeof dir === "string") {
                  updateProject.mutate({ id: projectId, data: { folder_path: dir } });
                }
              }}
              className="text-muted hover:text-[var(--color-text-secondary)]"
            >
              {t.set_folder}
            </Button>
          )}
        </div>

        {totalCount > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>{t.progress}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-[var(--color-input)] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <ProjectBlockLayout project={project} projectId={projectId} renderBlock={renderBlock} />

        {sectionCtxMenu && (
          <ContextMenu
            x={sectionCtxMenu.x}
            y={sectionCtxMenu.y}
            onClose={() => setSectionCtxMenu(null)}
            items={[
              { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/projects/${projectId}`, project?.name ?? "") },
            ]}
          />
        )}
      </div>
  );
}

