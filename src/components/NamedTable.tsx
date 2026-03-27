import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  useProjectTableRows,
  useCreateProjectTableRow,
  useUpdateProjectTableRow,
  useDeleteProjectTableRow,
  useUpdateProjectTable,
  useDeleteProjectTable,
} from "../db/hooks/useProjectTables";
import { useT } from "../i18n/useT";
import { getTagColor } from "../lib/tagColors";
import { useAppStore } from "../stores/app-store";
import type { ProjectTable, TableColumnDef, ProjectTableRow } from "../types/project-table";

interface Props {
  table: ProjectTable;
  projectId: number;
}

export function NamedTable({ table, projectId }: Props) {
  const t = useT();
  const darkMode = useAppStore((s) => s.darkMode);
  const { data: rows } = useProjectTableRows(table.id);
  const createRow = useCreateProjectTableRow(table.id);
  const updateRow = useUpdateProjectTableRow(table.id);
  const deleteRow = useDeleteProjectTableRow(table.id);
  const updateTable = useUpdateProjectTable(projectId);
  const deleteTable = useDeleteProjectTable(projectId);

  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tableName, setTableName] = useState(table.name);
  const [editingCell, setEditingCell] = useState<{ rowId: number; colId: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showColPicker, setShowColPicker] = useState(false);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [colName, setColName] = useState("");
  const [colOptions, setColOptions] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const colEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  useEffect(() => {
    if (editingCell) cellInputRef.current?.focus();
  }, [editingCell]);

  const commitName = () => {
    const name = tableName.trim();
    if (name && name !== table.name) {
      updateTable.mutate({ id: table.id, data: { name } });
    } else {
      setTableName(table.name);
    }
    setEditingName(false);
  };

  const startEditing = (row: ProjectTableRow, col: TableColumnDef) => {
    const val = row.data[col.id];
    setEditingCell({ rowId: row.id, colId: col.id });
    setEditValue(val != null ? String(val) : "");
  };

  const commitCell = (row: ProjectTableRow, col: TableColumnDef) => {
    let parsedValue: unknown = editValue;
    if (col.type === "number") parsedValue = editValue === "" ? null : Number(editValue);
    const newData = { ...row.data, [col.id]: parsedValue };
    updateRow.mutate({ id: row.id, data: newData });
    setEditingCell(null);
  };

  const toggleCheckbox = (row: ProjectTableRow, colId: string) => {
    const current = !!row.data[colId];
    updateRow.mutate({ id: row.id, data: { ...row.data, [colId]: !current } });
  };

  const updateSelect = (row: ProjectTableRow, colId: string, value: string) => {
    updateRow.mutate({ id: row.id, data: { ...row.data, [colId]: value } });
  };

  // Close column picker on outside click
  useEffect(() => {
    if (!showColPicker) return;
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColPicker]);

  // Close column editor on outside click
  useEffect(() => {
    if (!editingCol) return;
    const handler = (e: MouseEvent) => {
      if (colEditorRef.current && !colEditorRef.current.contains(e.target as Node)) {
        commitColEdit();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingCol, colName, colOptions]);

  const openColEditor = (col: TableColumnDef) => {
    setEditingCol(col.id);
    setColName(col.name);
    setColOptions(col.options ?? []);
  };

  const commitColEdit = () => {
    if (!editingCol) return;
    const updated = cols.map((c) =>
      c.id === editingCol ? { ...c, name: colName.trim() || c.name, options: (c.type === "select" || c.type === "tags") ? colOptions.filter((o) => o.trim()) : c.options } : c
    );
    updateTable.mutate({ id: table.id, data: { column_config: updated } });
    setEditingCol(null);
  };

  const deleteColumn = (colId: string) => {
    const updated = cols.filter((c) => c.id !== colId);
    updateTable.mutate({ id: table.id, data: { column_config: updated } });
    setEditingCol(null);
  };

  const addColumn = (type: TableColumnDef["type"]) => {
    const id = `col_${Date.now()}`;
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    const newCol: TableColumnDef = { id, name, type };
    if (type === "select" || type === "tags") newCol.options = ["Option 1", "Option 2"];
    updateTable.mutate({ id: table.id, data: { column_config: [...table.column_config, newCol] } });
    setShowColPicker(false);
  };

  const cols = table.column_config;

  return (
    <div className="rounded-xl bg-[var(--color-surface)] overflow-visible">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)]">
        <button onClick={() => setCollapsed(!collapsed)} className="text-muted hover:text-gray-700">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        {editingName ? (
          <input
            ref={nameInputRef}
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setTableName(table.name); setEditingName(false); }
            }}
            className="text-sm font-medium bg-transparent border-b border-accent outline-none"
          />
        ) : (
          <span
            className="text-sm font-medium cursor-pointer hover:text-accent"
            onDoubleClick={() => setEditingName(true)}
          >
            {table.name}
          </span>
        )}
        <span className="text-xs text-muted ml-1">({rows?.length ?? 0})</span>
        <div className="flex-1" />
        <button
          onClick={() => setEditingName(true)}
          className="text-muted hover:text-accent opacity-0 group-hover:opacity-100"
          title={t.rename}
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={async () => { if (await ask(t.confirm_delete_table, { kind: "warning" })) deleteTable.mutate(table.id); }}
          className="text-muted hover:text-red-500"
          title={t.delete}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {!collapsed && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-header)]">
                <th className="w-6 px-1" />
                {cols.map((col) => (
                  <th
                    key={col.id}
                    className="px-3 py-1.5 text-left text-xs text-muted relative"
                    style={{ width: col.width ?? 150 }}
                  >
                    <button
                      type="button"
                      onClick={() => openColEditor(col)}
                      className="hover:text-accent cursor-pointer"
                    >
                      {col.name}
                    </button>
                    {editingCol === col.id && (
                      <div
                        ref={colEditorRef}
                        className="absolute left-0 top-full mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] p-3 min-w-[200px]"
                      >
                        <label className="block text-[10px] text-muted mb-1">{t.rename}</label>
                        <input
                          value={colName}
                          onChange={(e) => setColName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") commitColEdit(); }}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs mb-2"
                          autoFocus
                        />
                        {(col.type === "select" || col.type === "tags") && (
                          <>
                            <label className="block text-[10px] text-muted mb-1">{t.options ?? "Options"}</label>
                            {colOptions.map((opt, i) => (
                              <div key={i} className="flex items-center gap-1 mb-1">
                                <input
                                  value={opt}
                                  onChange={(e) => {
                                    const next = [...colOptions];
                                    next[i] = e.target.value;
                                    setColOptions(next);
                                  }}
                                  className="flex-1 border border-gray-200 rounded px-2 py-0.5 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => setColOptions(colOptions.filter((_, j) => j !== i))}
                                  className="text-muted hover:text-red-500"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => setColOptions([...colOptions, ""])}
                              className="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                            >
                              <Plus size={10} /> {t.add_row}
                            </button>
                          </>
                        )}
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border-divider)]">
                          <button
                            type="button"
                            onClick={() => deleteColumn(col.id)}
                            className="text-[10px] text-red-500 hover:underline"
                          >
                            {t.delete_column}
                          </button>
                          <button
                            type="button"
                            onClick={commitColEdit}
                            className="text-[10px] text-accent hover:underline"
                          >
                            {t.save}
                          </button>
                        </div>
                      </div>
                    )}
                  </th>
                ))}
                <th className="w-10 relative">
                  <button
                    onClick={() => setShowColPicker((v) => !v)}
                    className="text-muted hover:text-accent transition-colors p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-200"
                    title={t.add_column}
                  >
                    <Plus size={14} />
                  </button>
                  {showColPicker && (
                    <div
                      ref={colPickerRef}
                      className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[140px]"
                    >
                      {(["text", "number", "checkbox", "select", "tags", "date"] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => addColumn(type)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-row)] capitalize"
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  )}
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] group">
                  <td className="w-6 px-1 text-muted cursor-grab">
                    <GripVertical size={12} />
                  </td>
                  {cols.map((col) => (
                    <td key={col.id} className="px-3 py-1.5" style={{ width: col.width ?? 150 }}>
                      {renderCell(row, col)}
                    </td>
                  ))}
                  <td className="w-10" />
                  <td className="w-8 text-right pr-2">
                    <button
                      onClick={() => deleteRow.mutate(row.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 transition-opacity"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => createRow.mutate(undefined)}
            className="flex items-center gap-1 text-xs text-accent hover:underline px-3 py-2 w-full text-left"
          >
            <Plus size={12} /> {t.add_row}
          </button>
        </>
      )}
    </div>
  );

  function renderCell(row: ProjectTableRow, col: TableColumnDef) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;

    switch (col.type) {
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={!!row.data[col.id]}
            onChange={() => toggleCheckbox(row, col.id)}
            className="accent-[var(--accent)]"
          />
        );
      case "select":
        return (
          <select
            value={(row.data[col.id] as string) ?? ""}
            onChange={(e) => updateSelect(row, col.id, e.target.value)}
            className="text-xs bg-transparent border-0 outline-none cursor-pointer"
          >
            <option value="">—</option>
            {(col.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      case "tags": {
        const selected = (row.data[col.id] as string[] | undefined) ?? [];
        const available = (col.options ?? []).filter((o) => !selected.includes(o));
        const addTag = (tag: string) => {
          updateRow.mutate({ id: row.id, data: { ...row.data, [col.id]: [...selected, tag] } });
        };
        const removeTag = (tag: string) => {
          updateRow.mutate({ id: row.id, data: { ...row.data, [col.id]: selected.filter((t) => t !== tag) } });
        };
        return (
          <div className="flex flex-wrap gap-1 items-center">
            {selected.map((tag) => {
              const color = getTagColor(tag, darkMode);
              return (
                <span
                  key={tag}
                  style={{ background: color.bg, color: color.text }}
                  className="px-1.5 py-0.5 text-[10px] rounded-full flex items-center gap-0.5"
                >
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="hover:text-danger">
                    <X size={8} />
                  </button>
                </span>
              );
            })}
            {available.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => addTag(opt)}
                className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-50 dark:bg-gray-200 text-muted hover:text-accent hover:bg-accent-light transition-colors"
              >
                + {opt}
              </button>
            ))}
          </div>
        );
      }
      case "date":
        return (
          <input
            type="date"
            value={(row.data[col.id] as string) ?? ""}
            onChange={(e) => updateRow.mutate({ id: row.id, data: { ...row.data, [col.id]: e.target.value } })}
            className="text-xs bg-transparent border-0 outline-none"
          />
        );
      default:
        if (isEditing) {
          return (
            <input
              ref={cellInputRef}
              type={col.type === "number" ? "number" : "text"}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitCell(row, col)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCell(row, col);
                if (e.key === "Escape") setEditingCell(null);
              }}
              className="w-full bg-transparent border-b border-accent outline-none text-sm"
            />
          );
        }
        return (
          <span
            className="cursor-pointer hover:text-accent block truncate"
            onDoubleClick={() => startEditing(row, col)}
          >
            {row.data[col.id] != null ? String(row.data[col.id]) : <span className="text-gray-300">—</span>}
          </span>
        );
    }
  }
}
