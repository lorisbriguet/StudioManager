import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Settings2, X, ChevronRight, ChevronDown, Copy, Download, Sigma } from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WorkloadCell } from "./WorkloadCell";
import {
  useWorkloadRows,
  useCreateWorkloadRow,
  useUpdateWorkloadRow,
  useDeleteWorkloadRow,
  useReorderWorkloadRows,
  useCreateWorkloadTemplate,
  useWorkloadTemplates,
  useProjectWorkloadConfig,
  useSetProjectWorkloadConfig,
} from "../../db/hooks/useWorkload";
import { useTasksByProject } from "../../db/hooks/useTasks";
import type { WorkloadColumn, WorkloadRow, SelectOption } from "../../types/workload";
import type { Task } from "../../types/task";
import { COLUMN_ICONS } from "./columnIcons";
import { evaluateFormula } from "../../lib/formulaEval";
import { useT } from "../../i18n/useT";

interface Props {
  projectId: number;
  onEditColumn?: (column: WorkloadColumn | null, index: number) => void;
}

export function WorkloadTable({ projectId, onEditColumn }: Props) {
  const t = useT();
  const { data: rows } = useWorkloadRows(projectId);
  const { data: config } = useProjectWorkloadConfig(projectId);
  const { data: templates } = useWorkloadTemplates();
  const { data: tasks } = useTasksByProject(projectId);
  const createRow = useCreateWorkloadRow();
  const updateRow = useUpdateWorkloadRow(projectId);
  const deleteRow = useDeleteWorkloadRow(projectId);
  const reorderRows = useReorderWorkloadRows(projectId);
  const createTemplate = useCreateWorkloadTemplate();
  const setConfig = useSetProjectWorkloadConfig(projectId);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [isOpen, setIsOpen] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [headerMenu, setHeaderMenu] = useState<{ ci: number; pos: { top: number; left: number } } | null>(null);

  const columns: WorkloadColumn[] = config?.columns ?? [];
  const templateId = config?.template_id ?? null;

  // Ref to avoid stale closures in pointer event handlers (e.g. column resize)
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const templateIdRef = useRef(templateId);
  templateIdRef.current = templateId;

  const handleTemplateChange = useCallback(
    (newTemplateId: number | null) => {
      if (!templates) return;
      const tpl = templates.find((t) => t.id === newTemplateId);
      if (tpl) {
        setConfig.mutate(
          { templateId: tpl.id, columns: tpl.columns },
          { onSuccess: () => toast.success(t.toast_status_updated) }
        );
      }
    },
    [templates, setConfig, t]
  );

  const handleAddRow = useCallback(() => {
    createRow.mutate({
      project_id: projectId,
      template_id: templateId,
      task_id: null,
      cells: {},
      sort_order: rows?.length ?? 0,
    });
  }, [projectId, templateId, rows, createRow]);

  const handleCellChange = useCallback(
    (row: WorkloadRow, colKey: string, value: unknown) => {
      const nextCells = { ...row.cells, [colKey]: value };
      updateRow.mutate({ id: row.id, cells: nextCells });
    },
    [updateRow]
  );

  const handleLinkTask = useCallback(
    (row: WorkloadRow, taskId: number | null) => {
      updateRow.mutate({ id: row.id, task_id: taskId });
    },
    [updateRow]
  );

  const handleSaveAsTemplate = useCallback(() => {
    if (columns.length === 0) return;
    setSaveTemplateName("");
    setShowSaveModal(true);
  }, [columns]);

  const handleDuplicateRow = useCallback(
    (row: WorkloadRow) => {
      createRow.mutate({
        project_id: projectId,
        template_id: templateId,
        task_id: row.task_id,
        cells: { ...row.cells },
        sort_order: (rows?.length ?? 0),
      });
    },
    [projectId, templateId, rows, createRow]
  );

  const confirmSaveTemplate = useCallback(() => {
    if (!saveTemplateName.trim()) return;
    createTemplate.mutate(
      { name: saveTemplateName.trim(), columns },
      { onSuccess: () => toast.success(t.toast_created) }
    );
    setShowSaveModal(false);
  }, [saveTemplateName, columns, createTemplate, t]);

  const handleMoveColumn = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= columns.length) return;
      const next = [...columns];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setConfig.mutate({ templateId, columns: next });
    },
    [columns, templateId, setConfig]
  );

  const handleToggleSum = useCallback(
    (colIndex: number) => {
      const next = [...columns];
      const col = next[colIndex];
      next[colIndex] = { ...col, showSum: col.showSum === false ? undefined : false };
      setConfig.mutate({ templateId, columns: next });
    },
    [columns, templateId, setConfig]
  );

  const handleOptionsChange = useCallback(
    (colIndex: number, newOptions: SelectOption[]) => {
      const next = [...columns];
      next[colIndex] = { ...next[colIndex], options: newOptions };
      setConfig.mutate({ templateId, columns: next });
    },
    [columns, templateId, setConfig]
  );

  // ── Row drag reorder (dnd-kit) ────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !rows) return;
      if (sortKey) { setSortKey(null); return; }
      const ordered = [...rows].sort((a, b) => a.sort_order - b.sort_order);
      const fromIdx = ordered.findIndex((r) => r.id === active.id);
      const toIdx = ordered.findIndex((r) => r.id === over.id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [moved] = ordered.splice(fromIdx, 1);
        ordered.splice(toIdx, 0, moved);
        reorderRows.mutate(ordered.map((r) => r.id));
      }
    },
    [rows, sortKey, reorderRows]
  );

  // ── Column resize by drag ─────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    startW: number;
  } | null>(null);

  const getColWidth = (col: WorkloadColumn) =>
    colWidths[col.key] ?? col.width ?? 120;

  const onResizeStart = useCallback(
    (e: React.PointerEvent, colIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      const col = columnsRef.current[colIndex];
      if (!col) return;
      const startW = colWidths[col.key] ?? col.width ?? 120;
      resizingRef.current = { colIndex, startX: e.clientX, startW };

      const onPointerMove = (ev: PointerEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - resizingRef.current.startX;
        const newW = Math.max(24, resizingRef.current.startW + delta);
        setColWidths((prev) => ({ ...prev, [col.key]: newW }));
      };

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        if (!resizingRef.current) return;
        const { colIndex: ci } = resizingRef.current;
        // Use refs to get latest columns/templateId (avoids stale closure)
        const latestCols = columnsRef.current;
        const latestTplId = templateIdRef.current;
        setColWidths((prev) => {
          const w = prev[col.key] ?? col.width ?? 120;
          const next = [...latestCols];
          next[ci] = { ...next[ci], width: w };
          setConfig.mutate({ templateId: latestTplId, columns: next });
          return prev;
        });
        resizingRef.current = null;
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [colWidths, setConfig]
  );

  const sortedRows = useMemo(() => {
    if (!rows) return [];
    if (!sortKey) return [...rows].sort((a, b) => a.sort_order - b.sort_order);
    return [...rows].sort((a, b) => {
      const av = a.cells[sortKey];
      const bv = b.cells[sortKey];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const rowIds = useMemo(() => sortedRows.map((r) => r.id), [sortedRows]);

  const handleExportCsv = useCallback(() => {
    if (!sortedRows.length || columns.length === 0) return;
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const headers = columns.map((c) => escape(c.name));
    const lines = [headers.join(",")];
    for (const row of sortedRows) {
      const vals = columns.map((col) => {
        if (col.type === "formula" && col.formula) {
          return escape(evaluateFormula(col.formula, row.cells));
        }
        const v = row.cells[col.key];
        if (Array.isArray(v)) return escape(v.join(", "));
        if (typeof v === "boolean") return v ? "1" : "0";
        return escape(v);
      });
      lines.push(vals.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workload-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t.export_csv);
  }, [sortedRows, columns, projectId, t]);

  // Compute summary row (sum of number & formula columns)
  const summaryRow = useMemo(() => {
    if (!sortedRows.length) return null;
    const sums: Record<string, number> = {};
    for (const col of columns) {
      if (col.showSum === false) continue;
      if (col.type === "number") {
        sums[col.key] = sortedRows.reduce((sum, r) => {
          const v = r.cells[col.key];
          return sum + (typeof v === "number" ? v : 0);
        }, 0);
      } else if (col.type === "formula" && col.formula) {
        sums[col.key] = sortedRows.reduce((sum, r) => {
          const v = evaluateFormula(col.formula!, r.cells);
          return sum + (typeof v === "number" ? v : 0);
        }, 0);
      }
    }
    return sums;
  }, [sortedRows, columns]);

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 text-sm font-medium hover:text-accent"
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t.workload}
        </button>
        {isOpen && (
          <div className="flex items-center gap-2">
            <select
              value={templateId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "__save__") {
                  handleSaveAsTemplate();
                } else {
                  handleTemplateChange(val ? Number(val) : null);
                }
              }}
              className="text-xs border border-gray-200 rounded px-2 py-1"
            >
              <option value="">{t.select_template}</option>
              {templates?.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
              {columns.length > 0 && (
                <option value="__save__">{t.save_as_template}</option>
              )}
            </select>
            {sortedRows.length > 0 && (
              <button
                onClick={handleExportCsv}
                className="p-1 text-muted hover:text-accent"
                title={t.export_csv}
              >
                <Download size={16} />
              </button>
            )}
            <button
              onClick={() => onEditColumn?.(null, columns.length)}
              className="p-1 text-muted hover:text-accent"
              title={t.add_column}
            >
              <Plus size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {isOpen && (<>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-8 px-2 border-r border-gray-200 sticky left-0 z-10 bg-gray-50" />
                {columns.map((col, ci) => {
                  const w = getColWidth(col);
                  const isFirstCol = ci === 0;
                  return (
                    <th
                      key={`${col.key}_${ci}`}
                      className={`relative px-2 py-1.5 text-left font-medium text-muted cursor-pointer hover:text-gray-700 select-none ${ci < columns.length - 1 ? "border-r border-gray-200" : ""} ${isFirstCol ? "sticky left-8 z-10 bg-gray-50" : ""}`}
                      style={{ width: w, minWidth: 24 }}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHeaderMenu((prev) =>
                          prev?.ci === ci ? null : { ci, pos: { top: rect.bottom + 2, left: rect.left } }
                        );
                      }}
                    >
                      <div className="flex items-center gap-1">
                        {col.icon && COLUMN_ICONS[col.icon] && (() => {
                          const Icon = COLUMN_ICONS[col.icon!];
                          return <Icon size={14} className="shrink-0" />;
                        })()}
                        {!col.iconOnly && (
                          <span className="truncate">{col.name}</span>
                        )}
                        {sortKey === col.key && (
                          <span className="text-[10px] ml-auto">
                            {sortDir === "asc" ? "\u2191" : "\u2193"}
                          </span>
                        )}
                      </div>
                      {/* Resize handle */}
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onResizeStart(e, ci);
                        }}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/50"
                      />
                    </th>
                  );
                })}
                <th className="w-14" />
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
            <tbody>
              {sortedRows.map((row) => (
                <SortableRow
                  key={row.id}
                  row={row}
                  columns={columns}
                  getColWidth={getColWidth}
                  handleCellChange={handleCellChange}
                  handleLinkTask={handleLinkTask}
                  handleOptionsChange={handleOptionsChange}
                  handleDuplicateRow={handleDuplicateRow}
                  deleteRow={deleteRow}
                  tasks={tasks}
                  t={t}
                />
              ))}
              {/* Summary row */}
              {summaryRow && sortedRows.length > 0 && (
                <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                  <td className="border-r border-gray-100 sticky left-0 z-10 bg-gray-50" />
                  {columns.map((col, ci) => (
                    <td
                      key={`${col.key}_${ci}`}
                      className={`px-3 py-2 text-sm ${ci < columns.length - 1 ? "border-r border-gray-100" : ""} ${ci === 0 ? "sticky left-8 z-10 bg-gray-50" : ""}`}
                    >
                      {(col.type === "number" || col.type === "formula") && summaryRow[col.key] !== undefined ? (
                        <span className="block text-right">
                          {Math.round(summaryRow[col.key] * 100) / 100}
                        </span>
                      ) : ci === 0 ? (
                        <span className="text-muted">{t.total}</span>
                      ) : null}
                    </td>
                  ))}
                  <td />
                </tr>
              )}
            </tbody>
            </SortableContext>
            </DndContext>
          </table>
        </div>

        {/* Add row button */}
        <button
          onClick={handleAddRow}
          className="w-full px-4 py-2 text-sm text-muted hover:text-accent hover:bg-gray-50 flex items-center gap-1 border-t border-gray-100"
        >
          <Plus size={14} />
          {t.new_row}
        </button>
      </div>
      </>)}

      {/* Column header menu */}
      {headerMenu && (() => {
        const col = columns[headerMenu.ci];
        if (!col) return null;
        return createPortal(
          <ColumnHeaderMenu
            pos={headerMenu.pos}
            col={col}
            colIndex={headerMenu.ci}
            colCount={columns.length}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key, dir) => {
              if (sortKey === key && sortDir === dir) {
                setSortKey(null);
              } else {
                setSortKey(key);
                setSortDir(dir);
              }
              setHeaderMenu(null);
            }}
            onEdit={() => { onEditColumn?.(col, headerMenu.ci); setHeaderMenu(null); }}
            onMoveLeft={() => { handleMoveColumn(headerMenu.ci, headerMenu.ci - 1); setHeaderMenu(null); }}
            onMoveRight={() => { handleMoveColumn(headerMenu.ci, headerMenu.ci + 1); setHeaderMenu(null); }}
            onToggleSum={() => { handleToggleSum(headerMenu.ci); setHeaderMenu(null); }}
            onClose={() => setHeaderMenu(null)}
            t={t}
          />,
          document.body
        );
      })()}

      {/* Save as template modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-100 rounded-xl shadow-2xl w-full max-w-sm border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-medium">{t.save_as_template}</h3>
              <button onClick={() => setShowSaveModal(false)} className="text-muted hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <label className="text-xs text-muted block mb-1">{t.template_name_prompt}</label>
              <input
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmSaveTemplate()}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50"
              >
                {t.cancel}
              </button>
              <button
                onClick={confirmSaveTemplate}
                disabled={!saveTemplateName.trim()}
                className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
              >
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sortable Row ────────────────────────────────────────────

function SortableRow({
  row,
  columns,
  getColWidth,
  handleCellChange,
  handleLinkTask,
  handleOptionsChange,
  handleDuplicateRow,
  deleteRow,
  tasks,
  t,
}: {
  row: WorkloadRow;
  columns: WorkloadColumn[];
  getColWidth: (col: WorkloadColumn) => number;
  handleCellChange: (row: WorkloadRow, colKey: string, value: unknown) => void;
  handleLinkTask: (row: WorkloadRow, taskId: number | null) => void;
  handleOptionsChange: (ci: number, opts: SelectOption[]) => void;
  handleDuplicateRow: (row: WorkloadRow) => void;
  deleteRow: { mutate: (id: number) => void };
  tasks: Task[] | undefined;
  t: Record<string, string>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b border-gray-100 hover:bg-gray-50 group/row"
    >
      <td className="border-r border-gray-100 sticky left-0 z-10 bg-inherit">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center w-full h-full min-h-[32px] cursor-grab text-muted opacity-0 group-hover/row:opacity-50"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </div>
      </td>
      {columns.map((col, ci) => (
        <td
          key={`${col.key}_${ci}`}
          className={`px-3 py-1.5 ${ci < columns.length - 1 ? "border-r border-gray-100" : ""} ${ci === 0 ? "sticky left-8 z-10 bg-inherit" : ""}`}
          style={{ width: getColWidth(col), minWidth: 24 }}
        >
          <WorkloadCell
            column={col}
            value={row.cells[col.key]}
            allCells={row.cells}
            onChange={(v) => handleCellChange(row, col.key, v)}
            tasks={col.type === "link" ? tasks ?? undefined : undefined}
            linkedTaskId={col.type === "link" ? row.task_id : undefined}
            onLinkTask={
              col.type === "link"
                ? (taskId) => handleLinkTask(row, taskId)
                : undefined
            }
            onOptionsChange={
              col.type === "select" || col.type === "multi_select"
                ? (opts) => handleOptionsChange(ci, opts)
                : undefined
            }
          />
        </td>
      ))}
      <td className="px-2 text-center">
        <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100">
          <button
            onClick={() => handleDuplicateRow(row)}
            className="p-0.5 text-muted hover:text-accent"
            title={t.duplicate_row}
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => deleteRow.mutate(row.id)}
            className="p-0.5 text-muted hover:text-red-600"
            title={t.delete}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Column Header Menu ──────────────────────────────────────

function ColumnHeaderMenu({
  pos,
  col,
  colIndex,
  colCount,
  sortKey,
  sortDir,
  onSort,
  onEdit,
  onMoveLeft,
  onMoveRight,
  onToggleSum,
  onClose,
  t,
}: {
  pos: { top: number; left: number };
  col: WorkloadColumn;
  colIndex: number;
  colCount: number;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSort: (key: string, dir: "asc" | "desc") => void;
  onEdit: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onToggleSum: () => void;
  onClose: () => void;
  t: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const isAsc = sortKey === col.key && sortDir === "asc";
  const isDesc = sortKey === col.key && sortDir === "desc";
  const isSummable = col.type === "number" || col.type === "formula";
  const sumVisible = col.showSum !== false;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 bg-gray-100 border border-gray-200 rounded-lg shadow-lg overflow-hidden py-1"
      style={{ top: pos.top, left: pos.left }}
    >
      {col.type !== "formula" && (
        <>
          <button
            onClick={() => onSort(col.key, "asc")}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-200 ${isAsc ? "text-accent" : ""}`}
          >
            <ArrowUp size={14} />
            {t.sort_ascending}
          </button>
          <button
            onClick={() => onSort(col.key, "desc")}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-200 ${isDesc ? "text-accent" : ""}`}
          >
            <ArrowDown size={14} />
            {t.sort_descending}
          </button>
          <div className="border-t border-gray-200 my-1" />
        </>
      )}
      {colIndex > 0 && (
        <button
          onClick={onMoveLeft}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-200"
        >
          <ArrowLeft size={14} />
          {t.move_left}
        </button>
      )}
      {colIndex < colCount - 1 && (
        <button
          onClick={onMoveRight}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-200"
        >
          <ArrowRight size={14} />
          {t.move_right}
        </button>
      )}
      {isSummable && (
        <>
          <div className="border-t border-gray-200 my-1" />
          <button
            onClick={onToggleSum}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-200 ${sumVisible ? "" : "text-muted"}`}
          >
            <Sigma size={14} />
            {sumVisible ? t.hide_sum : t.show_sum}
          </button>
        </>
      )}
      <div className="border-t border-gray-200 my-1" />
      <button
        onClick={onEdit}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-200"
      >
        <Settings2 size={14} />
        {t.edit_column}
      </button>
    </div>
  );
}
