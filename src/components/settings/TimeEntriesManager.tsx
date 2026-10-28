import { useState } from "react";
import { X, Pencil, Trash2, Check } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useTimeEntriesWithDetails, useUpdateTimeEntry, useDeleteTimeEntry } from "../../db/hooks/useTimeEntries";
import { useProjects } from "../../db/hooks/useProjects";
import { deleteWithUndo } from "../../lib/undo";
import { Button, DatePicker, Select, IconButton, Input, Table, TableSkeleton, FormField, FORM_GAP } from "../ui";
import { SectionHeader } from "../ui/Settings";

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

  const handleDelete = (id: number) => deleteWithUndo(deleteEntry, id, t.time_entry_deleted);

  return (
    <div>
      <SectionHeader title={t.time_entries_management} />

      {/* Filters */}
      <div className={`flex flex-wrap items-end ${FORM_GAP} mb-4`}>
        <FormField label={t.start}>
          <DatePicker size="sm" fullWidth={false}
            value={startDate || null}
            onChange={(v) => setStartDate(v ?? "")}
          />
        </FormField>
        <FormField label={t.end_date}>
          <DatePicker size="sm" fullWidth={false}
            value={endDate || null}
            onChange={(v) => setEndDate(v ?? "")}
          />
        </FormField>
        <FormField label={t.filter_by_project}>
          <Select
            value={projectFilter ?? ""}
            onChange={(e) => setProjectFilter(e.target.value ? Number(e.target.value) : undefined)}
            fullWidth={false}
          >
            <option value="">{t.all_projects}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </FormField>
        {(startDate || endDate || projectFilter) && (
          <Button
            type="button"
            variant="link"
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
        <TableSkeleton columns={5} rows={6} density="compact" />
      ) : (
          <Table density="compact">
            <Table.Head>
              <Table.Th className="w-[130px]">{t.date}</Table.Th>
              <Table.Th>{t.project}</Table.Th>
              <Table.Th>{t.tasks}</Table.Th>
              <Table.Th numeric className="w-[150px]">{t.duration}</Table.Th>
              <Table.Th className="w-full">{t.description}</Table.Th>
              <Table.ActionsTh />
            </Table.Head>
            <Table.Body>
              {rows.map((entry) => (
                <Table.Row key={entry.id}>
                  {editingId === entry.id ? (
                    <>
                      <Table.Td>
                        <DatePicker size="sm"
                          value={editForm.date || null}
                          onChange={(v) => setEditForm({ ...editForm, date: v ?? "" })}
                          className="min-w-[110px]"
                        />
                      </Table.Td>
                      <Table.Td muted>{entry.project_name}</Table.Td>
                      <Table.Td muted>{entry.task_title ?? "—"}</Table.Td>
                      <Table.Td numeric>
                        <div className="flex items-center justify-end gap-1">
                          <Input size="sm" fullWidth={false}
                            type="number"
                            min={0}
                            max={23}
                            value={editForm.hours}
                            onChange={(e) => setEditForm({ ...editForm, hours: Math.max(0, Number(e.target.value)) })}
                            className="w-14"
                          />
                          <span className="text-muted">h</span>
                          <Input size="sm" fullWidth={false}
                            type="number"
                            min={0}
                            max={59}
                            value={editForm.minutes}
                            onChange={(e) => setEditForm({ ...editForm, minutes: Math.max(0, Math.min(59, Number(e.target.value))) })}
                            className="w-14"
                          />
                          <span className="text-muted">m</span>
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <Input size="sm"
                          type="text"
                          value={editForm.description}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          className="min-w-[200px]"
                          placeholder={t.description}
                        />
                      </Table.Td>
                      <Table.Actions always>
                        <IconButton size="xs"
                          icon={Check}
                          label={t.save}
                          color="accent"
                          onClick={saveEdit}
                          disabled={updateEntry.isPending}
                        />
                        <IconButton size="xs" icon={X} label={t.cancel} onClick={() => setEditingId(null)} />
                      </Table.Actions>
                    </>
                  ) : (
                    <>
                      <Table.Td className="tabular-nums">{entry.date}</Table.Td>
                      <Table.Td>{entry.project_name}</Table.Td>
                      <Table.Td muted>{entry.task_title ?? "—"}</Table.Td>
                      <Table.Td numeric>{formatDuration(entry.duration_minutes)}</Table.Td>
                      <Table.Td muted className="max-w-[320px] truncate" title={entry.description}>{entry.description || "—"}</Table.Td>
                      <Table.Actions>
                        <IconButton icon={Pencil} label={t.edit_entry} size="xs" onClick={() => startEdit(entry)} />
                        <IconButton
                          icon={Trash2}
                          label={t.delete}
                          size="xs"
                          tone="danger"
                          disabled={deleteEntry.isPending}
                          onClick={() => handleDelete(entry.id)}
                        />
                      </Table.Actions>
                    </>
                  )}
                </Table.Row>
              ))}
              {rows.length === 0 && (
                <Table.Empty colSpan={6}>
                  <p className="text-xs text-muted py-4">{t.no_entries_found}</p>
                </Table.Empty>
              )}
            </Table.Body>
            {rows.length > 0 && (
              <Table.Foot>
                <Table.Td colSpan={3} muted>{t.total_hours}</Table.Td>
                <Table.Td numeric>{formatDuration(totalMinutes)}</Table.Td>
                <Table.Td colSpan={2} />
              </Table.Foot>
            )}
          </Table>
      )}
    </div>
  );
}
