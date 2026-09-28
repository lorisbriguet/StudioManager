import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Button } from "./ui";
import { TableCell } from "./named-table/TableCell";
import { ColumnEditorPopover } from "./named-table/ColumnEditorPopover";
import {
  useProjectTableRows,
  useCreateProjectTableRow,
  useUpdateProjectTableRow,
  useDeleteProjectTableRow,
  useUpdateProjectTable,
  useDeleteProjectTable,
} from "../db/hooks/useProjectTables";
import { useCustomLists, useCustomListItems, useCreateCustomList, useSetCustomListItems } from "../db/hooks/useCustomLists";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { toast } from "sonner";
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
  const [colPickerPos, setColPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [colEditorPos, setColEditorPos] = useState<{ top: number; left: number } | null>(null);
  const [colName, setColName] = useState("");
  const [colOptions, setColOptions] = useState<string[]>([]);
  const [colLinkedListId, setColLinkedListId] = useState<number | undefined>(undefined);
  const [showImportListDropdown, setShowImportListDropdown] = useState(false);
  const [saveAsListName, setSaveAsListName] = useState("");
  const [showSaveAsListInput, setShowSaveAsListInput] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const colPickerRef = useRef<HTMLDivElement>(null);

  const cols = table.column_config;

  const { data: customLists } = useCustomLists();
  const [importListId, setImportListId] = useState<number | null>(null);
  const { data: importListItems } = useCustomListItems(importListId);
  const createCustomList = useCreateCustomList();
  const setCustomListItems = useSetCustomListItems();

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

  // When import list items arrive, apply them
  useEffect(() => {
    if (!importListItems || importListId === null) return;
    setColOptions(importListItems.map((i) => i.value));
    setColLinkedListId(importListId);
    setImportListId(null);
    setShowImportListDropdown(false);
  }, [importListItems, importListId]);

  const handleImportFromList = (listId: number) => {
    setImportListId(listId);
  };

  const handleUnlinkList = () => {
    setColLinkedListId(undefined);
  };

  const handleSaveAsList = async () => {
    const name = saveAsListName.trim();
    if (!name || colOptions.length === 0) return;
    const id = await createCustomList.mutateAsync(name);
    await setCustomListItems.mutateAsync({ listId: id, items: colOptions.map((v) => ({ value: v })) });
    setShowSaveAsListInput(false);
    setSaveAsListName("");
    toast.success(t.list_created ?? "List created");
  };

  const openColEditor = (col: TableColumnDef, e?: React.MouseEvent) => {
    setEditingCol(col.id);
    setColName(col.name);
    setColOptions(col.options ?? []);
    setColLinkedListId(col.linked_list_id);
    setShowImportListDropdown(false);
    setShowSaveAsListInput(false);
    setSaveAsListName("");
    if (e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setColEditorPos({ top: rect.bottom + 4, left: rect.left });
    }
  };

  const commitColEdit = useCallback(() => {
    if (!editingCol) return;
    const updated = cols.map((c) => {
      if (c.id !== editingCol) return c;
      const base: TableColumnDef = { ...c, name: colName.trim() || c.name };
      if (c.type === "select" || c.type === "tags") {
        base.options = colOptions.filter((o) => o.trim());
        if (colLinkedListId !== undefined) {
          base.linked_list_id = colLinkedListId;
        } else {
          delete base.linked_list_id;
        }
      }
      return base;
    });
    updateTable.mutate({ id: table.id, data: { column_config: updated } });
    setEditingCol(null);
    setColEditorPos(null);
  }, [editingCol, cols, colName, colOptions, colLinkedListId, updateTable, table.id]);

  const deleteColumn = (colId: string) => {
    const updated = cols.filter((c) => c.id !== colId);
    updateTable.mutate({ id: table.id, data: { column_config: updated } });
    setEditingCol(null);
    setColEditorPos(null);
  };

  const addColumn = (type: TableColumnDef["type"]) => {
    const id = `col_${Date.now()}`;
    const name = (t as Record<string, string>)[`col_type_${type}`] ?? (type.charAt(0).toUpperCase() + type.slice(1));
    const newCol: TableColumnDef = { id, name, type };
    if (type === "select" || type === "tags") newCol.options = [t.default_option_1, t.default_option_2];
    updateTable.mutate({ id: table.id, data: { column_config: [...table.column_config, newCol] } });
    setShowColPicker(false);
  };

  return (
    <div className="rounded-xl bg-[var(--color-surface)] overflow-visible">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)]">
        <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t.expand : t.collapse} className="text-muted hover:text-[var(--color-text-secondary)]">
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
          aria-label={t.rename}
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={async () => { if (await ask(t.confirm_delete_table, { kind: "warning" })) deleteTable.mutate(table.id); }}
          className="text-muted hover:text-[var(--color-danger-text)]"
          title={t.delete}
          aria-label={t.delete}
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
                      onClick={(e) => openColEditor(col, e)}
                      className="hover:text-accent cursor-pointer"
                    >
                      {col.name}
                    </button>
                    {editingCol === col.id && colEditorPos && (
                      <ColumnEditorPopover
                        col={col}
                        pos={colEditorPos}
                        t={t}
                        colName={colName}
                        setColName={setColName}
                        colOptions={colOptions}
                        setColOptions={setColOptions}
                        colLinkedListId={colLinkedListId}
                        customLists={customLists}
                        showImportListDropdown={showImportListDropdown}
                        setShowImportListDropdown={setShowImportListDropdown}
                        showSaveAsListInput={showSaveAsListInput}
                        setShowSaveAsListInput={setShowSaveAsListInput}
                        saveAsListName={saveAsListName}
                        setSaveAsListName={setSaveAsListName}
                        onImportFromList={handleImportFromList}
                        onUnlinkList={handleUnlinkList}
                        onSaveAsList={handleSaveAsList}
                        onDelete={() => deleteColumn(col.id)}
                        onCommit={commitColEdit}
                      />
                    )}
                  </th>
                ))}
                <th className="w-10 relative">
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setColPickerPos({ top: rect.bottom + 4, left: rect.right - 140 });
                      setShowColPicker((v) => !v);
                    }}
                    className="text-muted hover:text-accent transition-colors p-0.5 rounded-md hover:bg-[var(--color-hover-row)]"
                    title={t.add_column}
                    aria-label={t.add_column}
                  >
                    <Plus size={14} />
                  </button>
                  {showColPicker && colPickerPos && createPortal(
                    <div
                      ref={colPickerRef}
                      className="fixed z-[9999] bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[140px]"
                      style={{ top: colPickerPos.top, left: colPickerPos.left }}
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
                    </div>,
                    document.body
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
                      <TableCell
                        row={row}
                        col={col}
                        darkMode={darkMode}
                        t={t}
                        isEditing={editingCell?.rowId === row.id && editingCell?.colId === col.id}
                        editValue={editValue}
                        cellInputRef={cellInputRef}
                        onStartEdit={() => startEditing(row, col)}
                        onEditValueChange={setEditValue}
                        onCommitEdit={() => commitCell(row, col)}
                        onCancelEdit={() => setEditingCell(null)}
                        onChange={(data) => updateRow.mutate({ id: row.id, data })}
                      />
                    </td>
                  ))}
                  <td className="w-10" />
                  <td className="w-8 text-right pr-2">
                    <button
                      onClick={() => deleteRow.mutate(row.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-[var(--color-danger-text)] transition-opacity"
                      aria-label={t.delete}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            variant="link"
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => createRow.mutate(undefined)}
            className="w-full px-3 py-2"
          >
            {t.add_row}
          </Button>
        </>
      )}
    </div>
  );
}
