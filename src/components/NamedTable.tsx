import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button, Card, DragHandle, Dropdown, ICONS, ICON_SIZE, InlineRename } from "./ui";
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
import { notify } from "../lib/notify";
import { deleteWithUndo, pushUndoable } from "../lib/undo";
import type { ProjectTable, TableColumnDef, ProjectTableRow } from "../types/project-table";
import { IconButton } from "./ui/IconButton";
import { Table } from "./ui/Table";

interface Props {
  table: ProjectTable;
  projectId: number;
}

export function NamedTable({ table, projectId }: Props) {
  const t = useT();
  const { data: rows } = useProjectTableRows(table.id);
  const createRow = useCreateProjectTableRow(table.id);
  const updateRow = useUpdateProjectTableRow(table.id);
  const deleteRow = useDeleteProjectTableRow(table.id);
  const updateTable = useUpdateProjectTable(projectId);
  const deleteTable = useDeleteProjectTable(projectId);

  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: number; colId: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [colEditorPos, setColEditorPos] = useState<{ top: number; left: number } | null>(null);
  const [colName, setColName] = useState("");
  const [colOptions, setColOptions] = useState<string[]>([]);
  const [colLinkedListId, setColLinkedListId] = useState<number | undefined>(undefined);
  const cellInputRef = useRef<HTMLInputElement>(null);

  const cols = table.column_config;

  const { data: customLists } = useCustomLists();
  const [importListId, setImportListId] = useState<number | null>(null);
  const { data: importListItems } = useCustomListItems(importListId);
  const createCustomList = useCreateCustomList();
  const setCustomListItems = useSetCustomListItems();

  useEffect(() => {
    if (editingCell) cellInputRef.current?.focus();
  }, [editingCell]);

  const commitName = (name: string) => {
    updateTable.mutate({ id: table.id, data: { name } });
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

  // When import list items arrive, apply them
  useEffect(() => {
    if (!importListItems || importListId === null) return;
    setColOptions(importListItems.map((i) => i.value));
    setColLinkedListId(importListId);
    setImportListId(null);
  }, [importListItems, importListId]);

  const handleImportFromList = (listId: number) => {
    setImportListId(listId);
  };

  const handleUnlinkList = () => {
    setColLinkedListId(undefined);
  };

  const handleSaveAsList = async (name: string) => {
    const id = await createCustomList.mutateAsync(name);
    await setCustomListItems.mutateAsync({ listId: id, items: colOptions.map((v) => ({ value: v })) });
    notify.success(t.list_created);
  };

  const openColEditor = (col: TableColumnDef, e?: React.MouseEvent) => {
    setEditingCol(col.id);
    setColName(col.name);
    setColOptions(col.options ?? []);
    setColLinkedListId(col.linked_list_id);
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

  // The rows keep the column's values, so putting the column back restores them.
  const deleteColumn = (colId: string) => {
    const prev = cols;
    const updated = cols.filter((c) => c.id !== colId);
    updateTable.mutate(
      { id: table.id, data: { column_config: updated } },
      {
        onSuccess: () =>
          pushUndoable(t.column_deleted, {
            label: t.undo_delete_column,
            execute: async () => {
              await updateTable.mutateAsync({ id: table.id, data: { column_config: prev } });
            },
            redo: async () => {
              await updateTable.mutateAsync({ id: table.id, data: { column_config: updated } });
            },
          }),
      }
    );
    setEditingCol(null);
    setColEditorPos(null);
  };

  const addColumn = (type: TableColumnDef["type"]) => {
    const id = `col_${Date.now()}`;
    const name = (t as Record<string, string>)[`col_type_${type}`] ?? (type.charAt(0).toUpperCase() + type.slice(1));
    const newCol: TableColumnDef = { id, name, type };
    if (type === "select" || type === "tags") newCol.options = [t.default_option_1, t.default_option_2];
    updateTable.mutate({ id: table.id, data: { column_config: [...table.column_config, newCol] } });
  };

  return (
    <Card tone="inset" padding="none" className="overflow-visible">
      {/* group/item on the header row: the rename pencil shows on its hover (or keyboard focus), not on the whole project block's. */}
      <Card.Header
        as="h3"
        className="group/item px-3 py-2"
        icon={
          <IconButton
            icon={collapsed ? ChevronRight : ChevronDown}
            label={collapsed ? t.expand : t.collapse}
            onClick={() => setCollapsed(!collapsed)}
          />
        }
        count={rows?.length ?? 0}
        action={
          <>
            <IconButton icon={ICONS.edit} label={t.rename} size="xs" tone="accent" reveal="item" onClick={() => setEditingName(true)} />
            <IconButton
              icon={ICONS.delete}
              label={t.delete}
              size="xs"
              tone="danger"
              onClick={() => deleteWithUndo(deleteTable, table.id, t.table_deleted)}
            />
          </>
        }
        title={editingName ? (
          <InlineRename
            value={table.name}
            label={t.rename}
            onSave={commitName}
            onCancel={() => setEditingName(false)}
            className="text-sm font-medium"
          />
        ) : (
          <span className="cursor-pointer hover:text-accent" onDoubleClick={() => setEditingName(true)}>
            {table.name}
          </span>
        )}
      />

      {!collapsed && (
        <>
          <Table density="compact">
            <Table.Head>
              <Table.Th narrow />
              {cols.map((col) => (
                  <Table.Th
                    key={col.id}
                    className="relative"
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
                        onImportFromList={handleImportFromList}
                        onUnlinkList={handleUnlinkList}
                        onSaveAsList={handleSaveAsList}
                        onDelete={() => deleteColumn(col.id)}
                        onCommit={commitColEdit}
                      />
                    )}
                  </Table.Th>
              ))}
              {/* The actions column: "add column" in its header, row actions below. */}
              <Table.ActionsTh>
                  <Dropdown
                    align="end"
                    trigger={
                      <IconButton icon={ICONS.add} label={t.add_column} size="xs" tone="accent" />
                    }
                    items={(["text", "number", "checkbox", "select", "tags", "date"] as const).map((type) => ({
                      label: type.charAt(0).toUpperCase() + type.slice(1),
                      onSelect: () => addColumn(type),
                    }))}
                  />
              </Table.ActionsTh>
            </Table.Head>
            <Table.Body>
              {(rows ?? []).map((row) => (
                <Table.Row key={row.id}>
                  <Table.Td narrow>
                    <DragHandle size={ICON_SIZE.control} />
                  </Table.Td>
                  {cols.map((col) => (
                    <Table.Td key={col.id} style={{ width: col.width ?? 150 }}>
                      <TableCell
                        row={row}
                        col={col}
                        isEditing={editingCell?.rowId === row.id && editingCell?.colId === col.id}
                        editValue={editValue}
                        cellInputRef={cellInputRef}
                        onStartEdit={() => startEditing(row, col)}
                        onEditValueChange={setEditValue}
                        onCommitEdit={() => commitCell(row, col)}
                        onCancelEdit={() => setEditingCell(null)}
                        onChange={(data) => updateRow.mutate({ id: row.id, data })}
                      />
                    </Table.Td>
                  ))}
                  <Table.Actions>
                    <IconButton icon={ICONS.delete} label={t.delete} size="xs" tone="danger" onClick={() => deleteWithUndo(deleteRow, row.id, t.row_deleted)} />
                  </Table.Actions>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <Button
            variant="link"
            icon={ICONS.add}
            onClick={() => createRow.mutate(undefined)}
            className="w-full px-3 py-2"
          >
            {t.add_row}
          </Button>
        </>
      )}
    </Card>
  );
}
