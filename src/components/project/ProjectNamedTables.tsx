import { Plus } from "lucide-react";
import { NamedTable } from "../NamedTable";
import { useProjectTables, useCreateProjectTable } from "../../db/hooks/useProjectTables";
import { useT } from "../../i18n/useT";

export function ProjectNamedTables({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: tables } = useProjectTables(projectId);
  const createTable = useCreateProjectTable(projectId);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => createTable.mutate({ name: t.untitled })}
          className="text-muted hover:text-accent"
          title={t.add_table}
          aria-label={t.add_table}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="space-y-3">
        {(!tables || tables.length === 0) && (
          <div className="text-xs text-muted">{t.no_tables_yet}</div>
        )}
        {(tables ?? []).map((tbl) => (
          <NamedTable key={tbl.id} table={tbl} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}
