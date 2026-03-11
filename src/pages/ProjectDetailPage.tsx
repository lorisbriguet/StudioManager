import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ProjectDetailContent } from "../components/ProjectDetailContent";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/projects" className="text-muted hover:text-gray-900">
          <ArrowLeft size={18} />
        </Link>
      </div>
      <ProjectDetailContent projectId={projectId} />
    </div>
  );
}
