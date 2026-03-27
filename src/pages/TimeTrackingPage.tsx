import { useMemo } from "react";
import { PageHeader, SearchBar } from "../components/ui";
import { useTimeOverviewData } from "../db/hooks/useWorkload";
import { useT } from "../i18n/useT";
import { useState } from "react";

function fmtMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Read-only Time Overview — aggregated tracked time across all projects.
 * Hidden by default; toggled via Settings > Behavior > showTimeOverview.
 */
export function TimeTrackingPage() {
  const t = useT();
  const { data: rows } = useTimeOverviewData();
  const [search, setSearch] = useState("");

  // Group by project
  const grouped = useMemo(() => {
    if (!rows) return [];
    const q = search.toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.task_title.toLowerCase().includes(q) ||
            r.project_name.toLowerCase().includes(q)
        )
      : rows;

    const map = new Map<
      number,
      {
        project_id: number;
        project_name: string;
        tasks: typeof filtered;
        totalTracked: number;
        totalPlanned: number;
      }
    >();
    for (const r of filtered) {
      let group = map.get(r.project_id);
      if (!group) {
        group = {
          project_id: r.project_id,
          project_name: r.project_name,
          tasks: [],
          totalTracked: 0,
          totalPlanned: 0,
        };
        map.set(r.project_id, group);
      }
      group.tasks.push(r);
      group.totalTracked += r.tracked_minutes;
      group.totalPlanned += r.planned_minutes ?? 0;
    }
    return Array.from(map.values());
  }, [rows, search]);

  const grandTotalTracked = grouped.reduce((s, g) => s + g.totalTracked, 0);
  const grandTotalPlanned = grouped.reduce((s, g) => s + g.totalPlanned, 0);

  return (
    <div>
      <PageHeader title={t.time_overview ?? "Time Overview"}>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder={t.search ?? "Search..."}
          className="w-48"
        />
      </PageHeader>

      {grouped.length === 0 ? (
        <div className="text-sm text-muted py-12 text-center">
          {t.no_time_data ?? "No tracked time yet."}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div
              key={group.project_id}
              className="border border-gray-100 rounded-lg overflow-hidden"
            >
              {/* Project header */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50/50 dark:bg-gray-100/50 border-b border-gray-100">
                <span className="text-sm font-medium">
                  {group.project_name}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {fmtMin(group.totalTracked)}
                  {group.totalPlanned > 0 && (
                    <span className="ml-1 text-muted">
                      / {fmtMin(group.totalPlanned)}
                    </span>
                  )}
                </span>
              </div>

              {/* Task rows */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted">
                      {t.tasks}
                    </th>
                    <th className="text-right px-3 py-1.5 text-xs font-medium text-muted w-[100px]">
                      {t.tracked ?? "Tracked"}
                    </th>
                    <th className="text-right px-3 py-1.5 text-xs font-medium text-muted w-[100px]">
                      {t.planned ?? "Planned"}
                    </th>
                    <th className="text-right px-3 py-1.5 text-xs font-medium text-muted w-[120px]">
                      {t.date}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map((task) => (
                    <tr
                      key={task.task_id}
                      className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-200"
                    >
                      <td className="px-3 py-1.5">
                        {task.task_title || (
                          <span className="text-muted italic">Untitled</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtMin(task.tracked_minutes)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                        {task.planned_minutes != null
                          ? fmtMin(task.planned_minutes)
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted">
                        {task.date?.slice(0, 10) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Grand total */}
          <div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
            <span>{t.total}</span>
            <span className="tabular-nums">
              {fmtMin(grandTotalTracked)}
              {grandTotalPlanned > 0 && (
                <span className="ml-1 text-muted">
                  / {fmtMin(grandTotalPlanned)}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
