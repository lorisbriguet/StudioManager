import { useState } from "react";
import { notify } from "../../lib/notify";
import { Button, Card, Tag, InlineRename, EmptyState, ICONS } from "../ui";
import {
  useWorkloadTemplates,
  useCreateWorkloadTemplate,
  useUpdateWorkloadTemplate,
  useDeleteWorkloadTemplate,
} from "../../db/hooks/useWorkload";
import { WorkloadColumnEditor } from "./WorkloadColumnEditor";
import { DEFAULT_WORKLOAD_COLUMNS } from "../../types/workload";
import type { WorkloadColumn } from "../../types/workload";
import { useT } from "../../i18n/useT";
import { IconButton } from "../ui/IconButton";
import { pushUndoable } from "../../lib/undo";
import type { WorkloadTemplate } from "../../types/workload";

export function WorkloadTemplateManager() {
  const t = useT();
  const { data: templates } = useWorkloadTemplates();
  const createTemplate = useCreateWorkloadTemplate();
  const updateTemplate = useUpdateWorkloadTemplate();
  const deleteTemplate = useDeleteWorkloadTemplate();

  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [editingColumn, setEditingColumn] = useState<{
    column: WorkloadColumn | null;
    index: number;
  } | null>(null);

  const editingTemplate = templates?.find((tp) => tp.id === editingTemplateId);

  const handleCreate = () => {
    createTemplate.mutate(
      { name: t.new_template, columns: DEFAULT_WORKLOAD_COLUMNS },
      {
        onSuccess: (id) => {
          notify.success(t.workload_template_created);
          setEditingTemplateId(id);
        },
      }
    );
  };

  const handleDuplicate = (tpl: typeof templates extends (infer T)[] | undefined ? T : never) => {
    if (!tpl) return;
    createTemplate.mutate(
      { name: t.copy_of_name.replace("{name}", tpl.name), columns: tpl.columns },
      { onSuccess: () => notify.success(t.template_duplicated) }
    );
  };

  // No question: Undo re-creates the template with its columns.
  const handleDelete = (tpl: WorkloadTemplate) => {
    deleteTemplate.mutate(tpl.id, {
      onSuccess: () => {
        if (editingTemplateId === tpl.id) setEditingTemplateId(null);
        pushUndoable(t.workload_template_deleted, {
          label: `${t.undo_delete_workload_template} "${tpl.name}"`,
          execute: async () => {
            await createTemplate.mutateAsync({ name: tpl.name, columns: tpl.columns });
          },
        });
      },
    });
  };

  const handleRenameCommit = (id: number, name: string) => {
    updateTemplate.mutate({ id, name });
    setRenamingId(null);
  };

  const handleSaveColumn = (col: WorkloadColumn) => {
    if (!editingTemplate || !editingColumn) return;
    let next = [...editingTemplate.columns];
    if (editingColumn.column) {
      next[editingColumn.index] = col;
    } else {
      next.push(col);
    }
    // Only one column can be the calendar color source — clear others
    if (col.calendarColor) {
      next = next.map((c) =>
        c.key === col.key ? c : { ...c, calendarColor: false }
      );
    }
    updateTemplate.mutate({ id: editingTemplate.id, columns: next });
  };

  const handleDeleteColumn = () => {
    if (!editingTemplate || !editingColumn) return;
    const { id, columns: prev } = editingTemplate;
    const next = prev.filter((_, i) => i !== editingColumn.index);
    updateTemplate.mutate(
      { id, columns: next },
      {
        onSuccess: () =>
          pushUndoable(t.column_deleted, {
            label: t.undo_delete_column,
            execute: async () => {
              await updateTemplate.mutateAsync({ id, columns: prev });
            },
            redo: async () => {
              await updateTemplate.mutateAsync({ id, columns: next });
            },
          }),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{t.workload_templates_desc}</p>
        <Button variant="primary" icon={ICONS.add} onClick={handleCreate}>
          {t.new_template}
        </Button>
      </div>

      {/* Template list */}
      <div className="space-y-2">
        {templates?.map((tpl) => (
          <Card
            key={tpl.id}
            tone="inset"
            padding="none"
            selected={editingTemplateId === tpl.id}
            className="overflow-hidden"
          >
            <Card.Header
              as="h3"
              className="px-3 py-2"
              count={tpl.columns.length}
              action={
                <>
                  <IconButton size="xs"
                    icon={ICONS.edit}
                    label={t.rename}
                    tone="accent"
                    onClick={() => setRenamingId(tpl.id)}
                  />
                  <IconButton size="xs" icon={ICONS.duplicate} label={t.duplicate} tone="accent" onClick={() => handleDuplicate(tpl)} />
                  <IconButton size="xs" icon={ICONS.delete} label={t.delete} tone="danger" onClick={() => handleDelete(tpl)} />
                </>
              }
              title={renamingId === tpl.id ? (
                <InlineRename
                  value={tpl.name}
                  label={t.rename}
                  onSave={(name) => handleRenameCommit(tpl.id, name)}
                  onCancel={() => setRenamingId(null)}
                  className="flex-1"
                />
              ) : (
                <button
                  type="button"
                  aria-expanded={editingTemplateId === tpl.id}
                  onClick={() => setEditingTemplateId(
                    editingTemplateId === tpl.id ? null : tpl.id
                  )}
                  className="text-left hover:text-accent"
                >
                  {tpl.name}
                </button>
              )}
            />

            {/* Expanded column list */}
            {editingTemplateId === tpl.id && (
              <div className="px-3 py-2 space-y-1">
                {tpl.columns.map((col, ci) => (
                  <div
                    key={col.key}
                    className="flex items-center gap-2 py-1 text-xs group/col"
                  >
                    <span className="w-32 truncate font-medium">{col.name}</span>
                    <span className="text-muted w-20">{col.type}</span>
                    {(col.type === "select" || col.type === "multi_select") &&
                      col.options && (
                        <div className="flex gap-0.5 flex-1 overflow-hidden">
                          {col.options.slice(0, 4).map((opt) => (
                            <Tag key={opt.value} name={opt.value} color={opt.color} size="xs" />
                          ))}
                          {col.options.length > 4 && (
                            <span className="text-muted">
                              +{col.options.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    {col.type === "formula" && (
                      <span className="text-muted font-mono text-[10px] truncate flex-1">
                        {col.formula}
                      </span>
                    )}
                    <IconButton
                      size="xs"
                      icon={ICONS.edit}
                      label={t.edit}
                      tone="accent"
                      reveal="col"
                      onClick={() => setEditingColumn({ column: col, index: ci })}
                      className="ml-auto"
                    />
                  </div>
                ))}
                <Button
                  variant="link"
                  icon={ICONS.add}
                  onClick={() =>
                    setEditingColumn({ column: null, index: tpl.columns.length })
                  }
                  className="py-1 text-muted hover:text-accent"
                >
                  {t.add_column}
                </Button>
              </div>
            )}
          </Card>
        ))}

        {(!templates || templates.length === 0) && (
          <EmptyState size="sm" message={t.no_workload_templates} />
        )}
      </div>

      {editingColumn !== null && (
        <WorkloadColumnEditor
          column={editingColumn.column}
          existingKeys={editingTemplate?.columns.map((c) => c.key) ?? []}
          onSave={handleSaveColumn}
          onDelete={editingColumn.column ? handleDeleteColumn : undefined}
          onClose={() => setEditingColumn(null)}
        />
      )}
    </div>
  );
}
