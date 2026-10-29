import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ConfirmButton, ICONS } from "../components/ui";
import { deleteWithUndo } from "../lib/undo";
import { ProjectDetailContent } from "../components/ProjectDetailContent";
import { useProject, useDeleteProject } from "../db/hooks/useProjects";
import { useTabStore } from "../stores/tab-store";
import { useT } from "../i18n/useT";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const { data: project } = useProject(projectId);
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const updateActiveTab = useTabStore((s) => s.updateActiveTab);
  const t = useT();

  // Update tab label with actual project name once loaded
  useEffect(() => {
    if (project?.name) {
      updateActiveTab(`/projects/${projectId}`, project.name);
    }
  }, [project?.name, projectId, updateActiveTab]);

  return (
    <ProjectDetailContent
      projectId={projectId}
      onBack={() => navigate(-1)}
      actions={
        <ConfirmButton
          label={t.delete}
          question={t.confirm_delete_project}
          icon={ICONS.delete}
          variant="danger"
          onConfirm={() => deleteWithUndo(deleteProject, projectId, t.toast_project_deleted, () => navigate("/projects"))}
        />
      }
    />
  );
}
