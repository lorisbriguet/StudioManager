import { Plus } from "lucide-react";
import { NamedTable } from "../NamedTable";
import { useProjectTables, useCreateProjectTable } from "../../db/hooks/useProjectTables";
import { useT } from "../../i18n/useT";
import { Button, EmptyState, IconButton, ListSkeleton, QueryError } from "../ui";

export function ProjectNamedTables({ projectId }: { projectId: number }) {
  const t = useT();
  const tablesQuery = useProjectTables(projectId);
  const tables = tablesQuery.data;
  const createTable = useCreateProjectTable(projectId);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <IconButton icon={Plus} label={t.add_table} tone="accent" onClick={() => createTable.mutate({ name: t.untitled })} />
      </div>
      <div className="space-y-3">
        {tables === undefined && (tablesQuery.isError
          ? <QueryError onRetry={tablesQuery.refetch} retrying={tablesQuery.isFetching} />
          : <ListSkeleton size="sm" rows={2} />)}
        {tables?.length === 0 && (
          <EmptyState
            size="sm"
            message={t.no_tables_yet}
            action={<Button variant="link" icon={<Plus size={12} />} onClick={() => createTable.mutate({ name: t.untitled })}>{t.add_table}</Button>}
          />
        )}
        {(tables ?? []).map((tbl) => (
          <NamedTable key={tbl.id} table={tbl} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}
