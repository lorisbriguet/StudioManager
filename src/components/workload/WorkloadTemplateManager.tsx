import { useState } from "react";
import { Plus, Trash2, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  useWorkloadTemplates,
  useCreateWorkloadTemplate,
  useUpdateWorkloadTemplate,
  useDeleteWorkloadTemplate,
} from "../../db/hooks/useWorkload";
import { WorkloadColumnEditor } from "./WorkloadColumnEditor";
import { TAG_COLORS, DEFAULT_WORKLOAD_COLUMNS } from "../../types/workload";
import type { WorkloadColumn } from "../../types/workload";
import { useT } from "../../i18n/useT";

export function WorkloadTemplateManager() {
  const t = useT();
  const { data: templates } = useWorkloadTemplates();
  const createTemplate = useCreateWorkloadTemplate();
  const updateTemplate = useUpdateWorkloadTemplate();
  const deleteTemplate = useDeleteWorkloadTemplate();

  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
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
          toast.success(t.toast_created);
          setEditingTemplateId(id);
        },
      }
    );
  };

  const handleDuplicate = (tpl: typeof templates extends (infer T)[] | undefined ? T : never) => {
    if (!tpl) return;
    createTemplate.mutate(
      { name: `${tpl.name} (copy)`, columns: tpl.columns },
      { onSuccess: () => toast.success(t.toast_created) }
    );
  };

  const handleDelete = (id: number) => {
    deleteTemplate.mutate(id, {
      onSuccess: () => {
        toast.success(t.toast_deleted);
        if (editingTemplateId === id) setEditingTemplateId(null);
      },
    });
  };

  const handleRenameCommit = (id: number) => {
    const val = renameValue.trim();
    if (val) {
      updateTemplate.mutate({ id, name: val });
    }
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
    const next = editingTemplate.columns.filter((_, i) => i !== editingColumn.index);
    updateTemplate.mutate({ id: editingTemplate.id, columns: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{t.workload_templates_desc}</p>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:opacity-90"
        >
          <Plus size={14} />
          {t.new_template}
        </button>
      </div>

      {/* Template list */}
      <div className="space-y-2">
        {templates?.map((tpl) => (
          <div
            key={tpl.id}
            className={`border rounded-lg overflow-hidden transition-colors ${
              editingTemplateId === tpl.id
                ? "border-accent"
                : "border-[var(--color-border-divider)]"
            }`}
          >
            {/* Template header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)]">
              {renamingId === tpl.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameCommit(tpl.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameCommit(tpl.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="flex-1 text-sm border border-[var(--color-border-divider)] rounded px-2 py-0.5 bg-transparent"
                />
              ) : (
                <button
                  onClick={() => setEditingTemplateId(
                    editingTemplateId === tpl.id ? null : tpl.id
                  )}
                  className="flex-1 text-left text-sm font-medium hover:text-accent"
                >
                  {tpl.name}
                  <span className="ml-2 text-xs text-muted font-normal">
                    ({tpl.columns.length} {t.columns})
                  </span>
                </button>
              )}
              <button
                onClick={() => {
                  setRenamingId(tpl.id);
                  setRenameValue(tpl.name);
                }}
                className="p-1 text-muted hover:text-accent"
                title={t.rename}
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => handleDuplicate(tpl)}
                className="p-1 text-muted hover:text-accent"
                title={t.duplicate}
              >
                <Copy size={12} />
              </button>
              <button
                onClick={() => handleDelete(tpl.id)}
                className="p-1 text-muted hover:text-[var(--color-danger-text)]"
                title={t.delete}
              >
                <Trash2 size={12} />
              </button>
            </div>

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
                          {col.options.slice(0, 4).map((opt) => {
                            const c = TAG_COLORS[opt.color] ?? TAG_COLORS.gray;
                            return (
                              <span
                                key={opt.value}
                                className={`px-1.5 py-0 rounded text-[10px] ${c.bg} ${c.text}`}
                              >
                                {opt.value}
                              </span>
                            );
                          })}
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
                    <button
                      onClick={() => setEditingColumn({ column: col, index: ci })}
                      className="ml-auto opacity-0 group-hover/col:opacity-100 p-0.5 text-muted hover:text-accent"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setEditingColumn({ column: null, index: tpl.columns.length })
                  }
                  className="flex items-center gap-1 py-1 text-xs text-muted hover:text-accent"
                >
                  <Plus size={12} />
                  {t.add_column}
                </button>
              </div>
            )}
          </div>
        ))}

        {(!templates || templates.length === 0) && (
          <p className="text-xs text-muted py-4 text-center">
            {t.no_templates}
          </p>
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
