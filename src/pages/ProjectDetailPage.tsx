import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "../components/ui";
import { toast } from "sonner";
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Update tab label with actual project name once loaded
  useEffect(() => {
    if (project?.name) {
      updateActiveTab(`/projects/${projectId}`, project.name);
    }
  }, [project?.name, projectId]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/projects" className="text-muted hover:text-gray-900">
          <ArrowLeft size={18} />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-red-600">{t.confirm_delete_project}</span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  deleteProject.mutate(projectId, {
                    onSuccess: () => {
                      toast.success(t.toast_project_deleted);
                      navigate("/projects");
                    },
                  });
                }}
              >
                {t.delete}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                {t.cancel}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={16} />}
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-muted hover:text-red-600"
              title={t.delete}
            />
          )}
        </div>
      </div>
      <ProjectDetailContent projectId={projectId} />
    </div>
  );
}
