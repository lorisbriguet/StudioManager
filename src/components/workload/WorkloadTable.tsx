import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Settings2, X, ChevronRight, ChevronDown, Copy, Download, Sigma, Pin, Play, Square } from "lucide-react";
import { Button } from "../ui";
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
  useUpdateWorkloadTemplate,
  useWorkloadTemplates,
  useProjectWorkloadConfig,
  useSetProjectWorkloadConfig,
} from "../../db/hooks/useWorkload";
import type { WorkloadColumn, WorkloadRow, SelectOption } from "../../types/workload";
import { COLUMN_ICONS } from "./columnIcons";
import { evaluateFormula } from "../../lib/formulaEval";
import { useT } from "../../i18n/useT";
import { useTimerActions } from "../../hooks/useTimerActions";

interface Props {
  projectId: number;
  onEditColumn?: (column: WorkloadColumn | null, index: number) => void;
}

// ── Duration formatting ─────────────────────────────────────
function fmtMin(mins: number | null | undefined): string {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
}

function parseMinInput(val: string): number {
  val = val.trim();
  // "1h30" or "1H30"
  const hm = val.match(/^(\d+)\s*[hH]\s*(\d+)?$/);
  if (hm) return parseInt(hm[1]) * 60 + (parseInt(hm[2] || "0"));
  // "1:30"
  const colon = val.match(/^(\d+):(\d+)$/);
  if (colon) return parseInt(colon[1]) * 60 + parseInt(colon[2]);
  // "1.5" (hours)
  const decimal = parseFloat(val);
  if (!isNaN(decimal) && val.includes(".")) return Math.round(decimal * 60);
  // Plain number = minutes
  const n = parseInt(val);
  return isNaN(n) ? 0 : n;
}

export function WorkloadTable({ projectId, onEditColumn }: Props) {
  const t = useT();
  const { data: rows } = useWorkloadRows(projectId);
  const { data: config } = useProjectWorkloadConfig(projectId);
  const { data: templates } = useWorkloadTemplates();
  const createRow = useCreateWorkloadRow();
  const updateRow = useUpdateWorkloadRow(projectId);
  const deleteRow = useDeleteWorkloadRow(projectId);
  const reorderRows = useReorderWorkloadRows(projectId);
  const createTemplate = useCreateWorkloadTemplate();
  const updateTemplate = useUpdateWorkloadTemplate();
  const setConfig = useSetProjectWorkloadConfig(projectId);
  const { activeTimer, toggleTimer } = useTimerActions();

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [isOpen, setIsOpen] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [headerMenu, setHeaderMenu] = useState<{ ci: number; pos: { top: number; left: number }; isSystem?: boolean } | null>(null);
  const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number } | null>(null);
  const [stickyFirstCol, setStickyFirstCol] = useState(() => {
    try { return localStorage.getItem(`workload_sticky_${projectId}`) === "1"; } catch { return false; }
  });

  const columns: WorkloadColumn[] = config?.columns ?? [];
  const templateId = config?.template_id ?? null;

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
      title: "",
      cells: {},
      sort_order: rows?.length ?? 0,
    });
  }, [projectId, rows, createRow]);

  const handleCellChange = useCallback(
    (row: WorkloadRow, colKey: string, value: unknown) => {
      const nextCells = { ...row.cells, [colKey]: value };
      updateRow.mutate({ id: row.id, cells: nextCells });
    },
    [updateRow]
  );

  /** Update a system column on a workload row (task) */
  const handleSystemChange = useCallback(
    (row: WorkloadRow, field: "title" | "tracked_minutes" | "planned_minutes", value: unknown) => {
      updateRow.mutate({ id: row.id, [field]: value });
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
        title: row.title,
        cells: { ...row.cells },
        sort_order: (rows?.length ?? 0),
      });
    },
    [projectId, rows, createRow]
  );

  const confirmSaveTemplate = useCallback(() => {
    const name = saveTemplateName.trim();
    if (!name) return;
    if (templates?.some((tpl) => tpl.name.toLowerCase() === name.toLowerCase())) {
      toast.error(t.template_name_exists);
      return;
    }
    createTemplate.mutate(
      { name, columns },
      { onSuccess: () => toast.success(t.toast_created) }
    );
    setShowSaveModal(false);
  }, [saveTemplateName, columns, createTemplate, templates, t]);

  const handleUpdateTemplate = useCallback(() => {
    if (!templateId || columns.length === 0) return;
    updateTemplate.mutate(
      { id: templateId, columns },
      { onSuccess: () => toast.success(t.toast_status_updated) }
    );
  }, [templateId, columns, updateTemplate, t]);

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
      const activeId = Number(active.id);
      const overId = Number(over.id);
      const ordered = [...rows].sort((a, b) => a.sort_order - b.sort_order);
      const fromIdx = ordered.findIndex((r) => r.id === activeId);
      const toIdx = ordered.findIndex((r) => r.id === overId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [moved] = ordered.splice(fromIdx, 1);
        ordered.splice(toIdx, 0, moved);
        reorderRows.mutate(ordered.map((r) => r.id));
      }
    },
    [rows, sortKey, reorderRows]
  );

  // ── Column resize by drag ─────────────────────────────────
  const [taskColWidth, setTaskColWidth] = useState(() => {
    try { return Number(localStorage.getItem(`workload_taskw_${projectId}`)) || 180; } catch { return 180; }
  });
  const taskColWidthRef = useRef(taskColWidth);
  taskColWidthRef.current = taskColWidth;
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{
    colIndex: number;
    startX: number;
    startW: number;
  } | null>(null);

  const getColWidth = (col: WorkloadColumn) =>
    colWidths[col.key] ?? col.width ?? 120;

  const onTaskColResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = taskColWidthRef.current;

      const onPointerMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const newW = Math.max(80, startW + delta);
        setTaskColWidth(newW);
      };

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        try { localStorage.setItem(`workload_taskw_${projectId}`, String(taskColWidthRef.current)); } catch { /* */ }
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [projectId]
  );

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
      // System column sorting
      if (sortKey === "__title") {
        const cmp = a.title.localeCompare(b.title);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "__duration") {
        const cmp = a.tracked_minutes - b.tracked_minutes;
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "__planned") {
        const cmp = (a.planned_minutes ?? 0) - (b.planned_minutes ?? 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      // Custom column sorting
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
    // System columns + custom columns
    const headers = [escape(t.tasks), escape(t.duration), escape(t.planned), ...columns.map((c) => escape(c.name))];
    const lines = [headers.join(",")];
    for (const row of sortedRows) {
      const systemVals = [
        escape(row.title),
        escape(fmtMin(row.tracked_minutes)),
        escape(fmtMin(row.planned_minutes)),
      ];
      const customVals = columns.map((col) => {
        if (col.type === "formula" && col.formula) {
          return escape(evaluateFormula(col.formula, row.cells));
        }
        const v = row.cells[col.key];
        if (Array.isArray(v)) return escape(v.join(", "));
        if (typeof v === "boolean") return v ? "1" : "0";
        return escape(v);
      });
      lines.push([...systemVals, ...customVals].join(","));
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

  // Compute summary row (sum of number & formula columns + system duration/planned)
  const summaryRow = useMemo(() => {
    if (!sortedRows.length) return null;
    const sums: Record<string, number> = {
      __duration: sortedRows.reduce((sum, r) => sum + r.tracked_minutes, 0),
      __planned: sortedRows.reduce((sum, r) => sum + (r.planned_minutes ?? 0), 0),
    };
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
    <div className="rounded-xl bg-[var(--color-surface)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 select-none">
        <button
          onClick={() => setIsOpen(!isOpen)}
          onContextMenu={(e) => { e.preventDefault(); setSectionMenu({ x: e.clientX, y: e.clientY }); }}
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
                } else if (val === "__update__") {
                  handleUpdateTemplate();
                } else {
                  handleTemplateChange(val ? Number(val) : null);
                }
              }}
              className="text-xs border border-[var(--color-border-divider)] rounded-lg px-2 py-1"
            >
              <option value="">{t.select_template}</option>
              {templates?.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}{tpl.is_system ? " *" : ""}
                </option>
              ))}
              {templateId && columns.length > 0 && (
                <option value="__update__">{t.update_template}</option>
              )}
              {columns.length > 0 && (
                <option value="__save__">{t.save_as_template}</option>
              )}
            </select>
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
      <div className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr className="border-b border-[var(--color-border-header)] select-none">
                {/* Drag handle column */}
                <th className={`w-8 px-2 ${stickyFirstCol ? "sticky left-0 z-10 bg-[var(--color-surface)]" : ""}`} />
                {/* System: Task */}
                <th
                  className={`relative px-4 py-2 text-left text-xs font-medium text-muted cursor-pointer hover:text-[var(--color-text-secondary)] select-none ${stickyFirstCol ? "sticky left-8 z-10 bg-[var(--color-surface)]" : ""}`}
                  style={{ width: taskColWidth, minWidth: 80 }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHeaderMenu((prev) =>
                      prev?.ci === -1 && prev?.isSystem ? null : { ci: -1, pos: { top: rect.bottom + 2, left: rect.left }, isSystem: true }
                    );
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{t.tasks}</span>
                    {sortKey === "__title" && <span className="text-[10px] ml-auto">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
                  </div>
                  {/* Resize handle */}
                  <div
                    onPointerDown={(e) => { e.stopPropagation(); onTaskColResizeStart(e); }}
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/50"
                  />
                </th>
                {/* System: Duration */}
                <th
                  className="relative px-4 py-2 text-left text-xs font-medium text-muted cursor-pointer hover:text-[var(--color-text-secondary)] select-none"
                  style={{ width: 90, minWidth: 60 }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHeaderMenu((prev) =>
                      prev?.ci === -2 && prev?.isSystem ? null : { ci: -2, pos: { top: rect.bottom + 2, left: rect.left }, isSystem: true }
                    );
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{t.duration}</span>
                    {sortKey === "__duration" && <span className="text-[10px] ml-auto">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
                  </div>
                </th>
                {/* System: Planned */}
                <th
                  className="relative px-4 py-2 text-left text-xs font-medium text-muted cursor-pointer hover:text-[var(--color-text-secondary)] select-none"
                  style={{ width: 90, minWidth: 60 }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHeaderMenu((prev) =>
                      prev?.ci === -3 && prev?.isSystem ? null : { ci: -3, pos: { top: rect.bottom + 2, left: rect.left }, isSystem: true }
                    );
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{t.planned}</span>
                    {sortKey === "__planned" && <span className="text-[10px] ml-auto">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
                  </div>
                </th>
                {/* Custom columns */}
                {columns.map((col, ci) => {
                  const w = getColWidth(col);
                  return (
                    <th
                      key={`${col.key}_${ci}`}
                      className="relative px-4 py-2 text-left text-xs font-medium text-muted cursor-pointer hover:text-[var(--color-text-secondary)] select-none"
                      style={{ width: w, minWidth: 24 }}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHeaderMenu((prev) =>
                          prev?.ci === ci && !prev?.isSystem ? null : { ci, pos: { top: rect.bottom + 2, left: rect.left } }
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
            <tbody>
              {sortedRows.map((row) => (
                <SortableRow
                  key={row.id}
                  row={row}
                  columns={columns}
                  taskColWidth={taskColWidth}
                  getColWidth={getColWidth}
                  handleCellChange={handleCellChange}
                  handleSystemChange={handleSystemChange}
                  handleOptionsChange={handleOptionsChange}
                  handleDuplicateRow={handleDuplicateRow}
                  deleteRow={deleteRow}
                  t={t}
                  stickyFirstCol={stickyFirstCol}
                  projectId={projectId}
                  activeTimer={activeTimer}
                  toggleTimer={toggleTimer}
                />
              ))}
              {/* Summary row */}
              {summaryRow && sortedRows.length > 0 && (
                <tr className="border-t border-[var(--color-border-header)] font-medium">
                  <td className={`${stickyFirstCol ? "sticky left-0 z-10 bg-[var(--color-surface)]" : ""}`} />
                  {/* System: Task total label */}
                  <td className={`px-4 py-2 text-sm ${stickyFirstCol ? "sticky left-8 z-10 bg-[var(--color-surface)]" : ""}`}>
                    <span className="text-muted">{t.total}</span>
                  </td>
                  {/* System: Duration total */}
                  <td className="px-4 py-2 text-sm text-right">
                    {fmtMin(summaryRow.__duration)}
                  </td>
                  {/* System: Planned total */}
                  <td className="px-4 py-2 text-sm text-right">
                    {fmtMin(summaryRow.__planned)}
                  </td>
                  {/* Custom columns */}
                  {columns.map((col, ci) => (
                    <td
                      key={`${col.key}_${ci}`}
                      className="px-4 py-2 text-sm"
                    >
                      {(col.type === "number" || col.type === "formula") && summaryRow[col.key] !== undefined ? (
                        <span className="block text-right">
                          {Math.round(summaryRow[col.key] * 100) / 100}
                        </span>
                      ) : null}
                    </td>
                  ))}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add row button */}
        <button
          onClick={handleAddRow}
          className="w-full px-4 py-2 text-sm text-muted hover:text-accent hover:bg-[var(--color-hover-row)] flex items-center gap-1 border-t border-[var(--color-border-divider)]"
        >
          <Plus size={14} />
          {t.new_row}
        </button>
      </div>
      </SortableContext>
      </DndContext>
      </>)}

      {/* Column header menu — system columns (sort-only) */}
      {headerMenu && headerMenu.isSystem && (() => {
        const keyMap: Record<number, string> = { [-1]: "__title", [-2]: "__duration", [-3]: "__planned" };
        const sysKey = keyMap[headerMenu.ci];
        if (!sysKey) return null;
        const isAsc = sortKey === sysKey && sortDir === "asc";
        const isDesc = sortKey === sysKey && sortDir === "desc";
        return createPortal(
          <SystemHeaderMenu
            pos={headerMenu.pos}
            isAsc={isAsc}
            isDesc={isDesc}
            onSort={(dir) => {
              if (sortKey === sysKey && sortDir === dir) {
                setSortKey(null);
              } else {
                setSortKey(sysKey);
                setSortDir(dir);
              }
              setHeaderMenu(null);
            }}
            onClose={() => setHeaderMenu(null)}
            t={t}
          />,
          document.body
        );
      })()}

      {/* Column header menu — custom columns */}
      {headerMenu && !headerMenu.isSystem && (() => {
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

      {/* Save as template modal — portalled so it escapes side-peek overflow */}
      {showSaveModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-divider)]">
              <h3 className="text-sm font-medium">{t.save_as_template}</h3>
              <button onClick={() => setShowSaveModal(false)} className="text-muted hover:text-[var(--color-text-secondary)]">
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <label className="text-xs text-muted block mb-1">{t.template_name_prompt}</label>
              <input
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmSaveTemplate()}
                className="w-full border border-[var(--color-border-divider)] rounded-lg px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-divider)]">
              <Button
                variant="secondary"
                onClick={() => setShowSaveModal(false)}
              >
                {t.cancel}
              </Button>
              <Button
                onClick={confirmSaveTemplate}
                disabled={!saveTemplateName.trim()}
              >
                {t.save}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Section context menu (right-click on "Workload" header) */}
      {sectionMenu && createPortal(
        <SectionContextMenu
          x={sectionMenu.x}
          y={sectionMenu.y}
          stickyFirstCol={stickyFirstCol}
          hasRows={sortedRows.length > 0}
          onTogglePin={() => {
            const next = !stickyFirstCol;
            setStickyFirstCol(next);
            try { localStorage.setItem(`workload_sticky_${projectId}`, next ? "1" : "0"); } catch { /* */ }
            setSectionMenu(null);
          }}
          onExportCsv={() => { handleExportCsv(); setSectionMenu(null); }}
          onClose={() => setSectionMenu(null)}
          t={t}
        />,
        document.body
      )}
    </div>
  );
}

// ── Section Context Menu ─────────────────────────────────────

function SectionContextMenu({
  x,
  y,
  stickyFirstCol,
  hasRows,
  onTogglePin,
  onExportCsv,
  onClose,
  t,
}: {
  x: number;
  y: number;
  stickyFirstCol: boolean;
  hasRows: boolean;
  onTogglePin: () => void;
  onExportCsv: () => void;
  onClose: () => void;
  t: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg overflow-hidden py-1"
      style={{ top: y, left: x }}
    >
      <button
        onClick={onTogglePin}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${stickyFirstCol ? "text-accent" : ""}`}
      >
        <Pin size={14} />
        {t.pin_first_column}
      </button>
      {hasRows && (
        <button
          onClick={onExportCsv}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)]"
        >
          <Download size={14} />
          {t.export_csv}
        </button>
      )}
    </div>
  );
}

// ── Sortable Row ────────────────────────────────────────────

function SortableRow({
  row,
  columns,
  taskColWidth,
  getColWidth,
  handleCellChange,
  handleSystemChange,
  handleOptionsChange,
  handleDuplicateRow,
  deleteRow,
  t,
  stickyFirstCol,
  projectId,
  activeTimer,
  toggleTimer,
}: {
  row: WorkloadRow;
  columns: WorkloadColumn[];
  taskColWidth: number;
  getColWidth: (col: WorkloadColumn) => number;
  handleCellChange: (row: WorkloadRow, colKey: string, value: unknown) => void;
  handleSystemChange: (row: WorkloadRow, field: "title" | "tracked_minutes" | "planned_minutes", value: unknown) => void;
  handleOptionsChange: (ci: number, opts: SelectOption[]) => void;
  handleDuplicateRow: (row: WorkloadRow) => void;
  deleteRow: { mutate: (id: number) => void };
  t: Record<string, string>;
  stickyFirstCol: boolean;
  projectId: number;
  activeTimer: { taskId: number; projectId: number; startedAt: number; projectName?: string } | null;
  toggleTimer: (taskId: number, projectId: number, projectName?: string) => Promise<void>;
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

  const isTimerActive = activeTimer?.taskId === row.id;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] group/row"
    >
      {/* Drag handle */}
      <td className={`${stickyFirstCol ? "sticky left-0 z-10" : ""} bg-inherit`}>
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center w-full h-full min-h-[32px] cursor-grab text-muted opacity-0 group-hover/row:opacity-50"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </div>
      </td>

      {/* System: Task title + timer button */}
      <td className={`px-4 py-2 ${stickyFirstCol ? "sticky left-8 z-10 bg-inherit" : ""}`} style={{ width: taskColWidth }}>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleTimer(row.id, projectId)}
            className={`shrink-0 p-0.5 rounded ${
              isTimerActive
                ? "text-red-500 hover:text-red-600"
                : "text-muted opacity-0 group-hover/row:opacity-100 hover:text-accent"
            }`}
            title={isTimerActive ? t.stop_timer : t.start_timer}
          >
            {isTimerActive ? <Square size={12} /> : <Play size={12} />}
          </button>
          <InlineTitle
            value={row.title}
            onChange={(v) => handleSystemChange(row, "title", v)}
          />
        </div>
      </td>

      {/* System: Duration (tracked_minutes) */}
      <td className="px-4 py-2" style={{ width: 90 }}>
        <InlineDuration
          value={row.tracked_minutes}
          isTimerActive={isTimerActive}
          timerStartedAt={isTimerActive ? activeTimer!.startedAt : undefined}
          onChange={(v) => handleSystemChange(row, "tracked_minutes", v)}
        />
      </td>

      {/* System: Planned (planned_minutes) */}
      <td className="px-4 py-2" style={{ width: 90 }}>
        <InlineDuration
          value={row.planned_minutes ?? 0}
          onChange={(v) => handleSystemChange(row, "planned_minutes", v)}
        />
      </td>

      {/* Custom columns */}
      {columns.map((col, ci) => (
        <td
          key={`${col.key}_${ci}`}
          className="px-4 py-2"
          style={{ width: getColWidth(col), minWidth: 24 }}
        >
          <WorkloadCell
            column={col}
            value={row.cells[col.key]}
            allCells={row.cells}
            onChange={(v) => handleCellChange(row, col.key, v)}
            onOptionsChange={
              col.type === "select" || col.type === "multi_select"
                ? (opts) => handleOptionsChange(ci, opts)
                : undefined
            }
          />
        </td>
      ))}

      {/* Row actions */}
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

// ── Inline Title Editor ────────────────────────────────────

function InlineTitle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className="text-sm cursor-text flex-1 min-w-0 break-words whitespace-pre-wrap"
        onDoubleClick={() => { setDraft(value); setEditing(true); }}
      >
        {value || <span className="text-muted italic">Untitled</span>}
      </span>
    );
  }

  return (
    <input
      className="text-sm w-full bg-transparent border-none outline-none flex-1 min-w-0"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed !== value) onChange(trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
    />
  );
}

// ── Inline Duration Editor ──────────────────────────────────

function InlineDuration({
  value,
  onChange,
  isTimerActive,
  timerStartedAt,
}: {
  value: number;
  onChange: (v: number) => void;
  isTimerActive?: boolean;
  timerStartedAt?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [liveElapsed, setLiveElapsed] = useState(0);

  // Live ticking when timer is active
  useEffect(() => {
    if (!isTimerActive || !timerStartedAt) {
      setLiveElapsed(0);
      return;
    }
    const tick = () => setLiveElapsed(Math.floor((Date.now() - timerStartedAt) / 60000));
    tick();
    const iv = setInterval(tick, 10000); // Update every 10s
    return () => clearInterval(iv);
  }, [isTimerActive, timerStartedAt]);

  const displayMins = isTimerActive ? value + liveElapsed : value;

  if (editing) {
    return (
      <input
        className="text-sm w-full bg-transparent border-none outline-none text-right"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const parsed = parseMinInput(draft);
          if (parsed !== value) onChange(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="0m"
      />
    );
  }

  return (
    <span
      className={`text-sm text-right block cursor-text ${isTimerActive ? "text-red-500 font-medium" : ""}`}
      onDoubleClick={() => {
        setDraft(fmtMin(value) || "0");
        setEditing(true);
      }}
    >
      {fmtMin(displayMins) || <span className="text-muted">-</span>}
    </span>
  );
}

// ── Column Header Menu ──────────────────────────────────────

function SystemHeaderMenu({
  pos,
  isAsc,
  isDesc,
  onSort,
  onClose,
  t,
}: {
  pos: { top: number; left: number };
  isAsc: boolean;
  isDesc: boolean;
  onSort: (dir: "asc" | "desc") => void;
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

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg overflow-hidden py-1"
      style={{ top: pos.top, left: pos.left }}
    >
      <button
        onClick={() => onSort("asc")}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${isAsc ? "text-accent" : ""}`}
      >
        <ArrowUp size={14} />
        {t.sort_ascending}
      </button>
      <button
        onClick={() => onSort("desc")}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${isDesc ? "text-accent" : ""}`}
      >
        <ArrowDown size={14} />
        {t.sort_descending}
      </button>
    </div>
  );
}

// ── Column Header Menu (custom columns) ─────────────────────

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
      className="fixed z-50 w-48 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg overflow-hidden py-1"
      style={{ top: pos.top, left: pos.left }}
    >
      {col.type !== "formula" && (
        <>
          <button
            onClick={() => onSort(col.key, "asc")}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${isAsc ? "text-accent" : ""}`}
          >
            <ArrowUp size={14} />
            {t.sort_ascending}
          </button>
          <button
            onClick={() => onSort(col.key, "desc")}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${isDesc ? "text-accent" : ""}`}
          >
            <ArrowDown size={14} />
            {t.sort_descending}
          </button>
          <div className="border-t border-[var(--color-border-divider)] my-1" />
        </>
      )}
      {colIndex > 0 && (
        <button
          onClick={onMoveLeft}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)]"
        >
          <ArrowLeft size={14} />
          {t.move_left}
        </button>
      )}
      {colIndex < colCount - 1 && (
        <button
          onClick={onMoveRight}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)]"
        >
          <ArrowRight size={14} />
          {t.move_right}
        </button>
      )}
      {isSummable && (
        <>
          <div className="border-t border-[var(--color-border-divider)] my-1" />
          <button
            onClick={onToggleSum}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${sumVisible ? "" : "text-muted"}`}
          >
            <Sigma size={14} />
            {sumVisible ? t.hide_sum : t.show_sum}
          </button>
        </>
      )}
      <div className="border-t border-[var(--color-border-divider)] my-1" />
      <button
        onClick={onEdit}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-hover-row)]"
      >
        <Settings2 size={14} />
        {t.edit_column}
      </button>
    </div>
  );
}
