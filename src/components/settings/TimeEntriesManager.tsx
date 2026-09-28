import { useState } from "react";
import { X, Pencil, Trash2, Check } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useTimeEntriesWithDetails, useUpdateTimeEntry, useDeleteTimeEntry } from "../../db/hooks/useTimeEntries";
import { useProjects } from "../../db/hooks/useProjects";
import { Button } from "../ui";
import { SectionHeader } from "./SettingsPrimitives";

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function TimeEntriesManager() {
  const t = useT();
  const { data: projects } = useProjects();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectFilter, setProjectFilter] = useState<number | undefined>(undefined);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ date: string; hours: number; minutes: number; description: string }>({
    date: "",
    hours: 0,
    minutes: 0,
    description: "",
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: entries, isLoading } = useTimeEntriesWithDetails(
    startDate || undefined,
    endDate || undefined,
    projectFilter
  );
  const updateEntry = useUpdateTimeEntry();
  const deleteEntry = useDeleteTimeEntry();

  const rows = entries ?? [];
  const totalMinutes = rows.reduce((sum, e) => sum + e.duration_minutes, 0);

  const startEdit = (entry: { id: number; date: string; duration_minutes: number; description: string }) => {
    setEditingId(entry.id);
    setEditForm({
      date: entry.date,
      hours: Math.floor(entry.duration_minutes / 60),
      minutes: entry.duration_minutes % 60,
      description: entry.description,
    });
  };

  const saveEdit = () => {
    if (editingId === null) return;
    const duration_minutes = editForm.hours * 60 + editForm.minutes;
    updateEntry.mutate(
      { id: editingId, data: { date: editForm.date, duration_minutes, description: editForm.description } },
      { onSuccess: () => setEditingId(null) }
    );
  };

  const handleDelete = (id: number) => {
    deleteEntry.mutate(id, { onSuccess: () => setConfirmDeleteId(null) });
  };

  return (
    <div>
      <SectionHeader title={t.time_entries_management} />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">{t.start}</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">{t.end_date}</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">{t.filter_by_project}</label>
          <select
            value={projectFilter ?? ""}
            onChange={(e) => setProjectFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)]"
          >
            <option value="">{t.all_projects}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {(startDate || endDate || projectFilter) && (
          <Button
            type="button"
            variant="link"
            size="sm"
            icon={<X size={12} />}
            onClick={() => { setStartDate(""); setEndDate(""); setProjectFilter(undefined); }}
            className="self-end pb-1 text-muted hover:text-[var(--color-text)]"
          >
            {t.cancel}
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-xs text-muted py-4">{t.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted py-4">{t.no_entries_found}</p>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-divider)] overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border-divider)] bg-[var(--color-surface)]">
                <th className="text-left px-3 py-2 font-medium text-muted w-[130px]">{t.date}</th>
                <th className="text-left px-3 py-2 font-medium text-muted">{t.project}</th>
                <th className="text-left px-3 py-2 font-medium text-muted">{t.tasks}</th>
                <th className="text-left px-3 py-2 font-medium text-muted w-[150px]">{t.duration}</th>
                <th className="text-left px-3 py-2 font-medium text-muted w-full">{t.description}</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--color-border-divider)] last:border-0 hover:bg-[var(--color-hover-row)]">
                  {editingId === entry.id ? (
                    <>
                      <td className="px-3 py-1.5">
                        <input
                          type="date"
                          value={editForm.date}
                          onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                          className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-1.5 py-1 text-xs w-full min-w-[110px]"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-muted">{entry.project_name}</td>
                      <td className="px-3 py-1.5 text-muted">{entry.task_title ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={editForm.hours}
                            onChange={(e) => setEditForm({ ...editForm, hours: Math.max(0, Number(e.target.value)) })}
                            className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-1.5 py-1 text-xs w-14"
                          />
                          <span className="text-muted">h</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            value={editForm.minutes}
                            onChange={(e) => setEditForm({ ...editForm, minutes: Math.max(0, Math.min(59, Number(e.target.value))) })}
                            className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-1.5 py-1 text-xs w-14"
                          />
                          <span className="text-muted">m</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={editForm.description}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          className="border border-[var(--color-input-border)] bg-[var(--color-input-bg)] rounded-lg px-1.5 py-1 text-xs w-full min-w-[200px]"
                          placeholder={t.description}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={updateEntry.isPending}
                            className="p-1 text-accent hover:bg-accent-light rounded-md"
                            title={t.save}
                            aria-label={t.save}
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1 text-muted hover:bg-[var(--color-hover-row)] rounded-md"
                            title={t.cancel}
                            aria-label={t.cancel}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 tabular-nums">{entry.date}</td>
                      <td className="px-3 py-2">{entry.project_name}</td>
                      <td className="px-3 py-2 text-muted">{entry.task_title ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{formatDuration(entry.duration_minutes)}</td>
                      <td className="px-3 py-2 text-muted max-w-[320px] truncate" title={entry.description}>{entry.description || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(entry)}
                            className="p-1 text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-hover-row)] rounded-md"
                            title={t.edit_entry}
                            aria-label={t.edit_entry}
                          >
                            <Pencil size={12} />
                          </button>
                          {confirmDeleteId === entry.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDelete(entry.id)}
                                disabled={deleteEntry.isPending}
                                className="px-1.5 py-0.5 bg-[var(--color-danger)] text-white rounded-md text-[10px] hover:opacity-80"
                              >
                                {t.delete}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="p-1 text-muted hover:bg-[var(--color-hover-row)] rounded-md"
                                aria-label={t.cancel}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(entry.id)}
                              className="p-1 text-muted hover:text-[var(--color-danger-text)] hover:bg-[var(--color-hover-row)] rounded-md"
                              title={t.delete}
                              aria-label={t.delete}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Total */}
      {rows.length > 0 && (
        <div className="mt-3 text-xs text-muted text-right">
          {t.total_hours}: <span className="font-medium text-[var(--color-text)]">{formatDuration(totalMinutes)}</span>
        </div>
      )}
    </div>
  );
}
