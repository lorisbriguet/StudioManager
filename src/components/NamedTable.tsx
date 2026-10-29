import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  useDeleteProjectTableColumn,
  useReorderProjectTableRows,
} from "../db/hooks/useProjectTables";
import { useCustomLists, useCustomListItems, useCreateCustomList, useSetCustomListItems } from "../db/hooks/useCustomLists";
import { useT } from "../i18n/useT";
import { notify } from "../lib/notify";
import { deleteWithUndo } from "../lib/undo";
import type { ProjectTable, TableColumnDef, ProjectTableRow } from "../types/project-table";
import { IconButton } from "./ui/IconButton";
import { Table } from "./ui/Table";

const COLUMN_TYPES = ["text", "number", "checkbox", "select", "tags", "date"] as const satisfies readonly TableColumnDef["type"][];

/** The label of each column type: the menu entry, and a new column's name. */
const COLUMN_TYPE_LABEL = {
  text: "column_type_text",
  number: "column_type_number",
  checkbox: "column_type_checkbox",
  select: "column_type_select",
  tags: "column_type_tags",
  date: "column_type_date",
} as const satisfies Record<TableColumnDef["type"], string>;

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
  const deleteCol = useDeleteProjectTableColumn(projectId);
  const reorderRows = useReorderProjectTableRows(table.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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
  // Undo puts it back into the columns as they are then (one added since stays).
  const deleteColumn = (colId: string) => {
    deleteWithUndo(deleteCol, { tableId: table.id, colId }, t.column_deleted);
    setEditingCol(null);
    setColEditorPos(null);
  };

  const addColumn = (type: TableColumnDef["type"]) => {
    const id = `col_${Date.now()}`;
    const newCol: TableColumnDef = { id, name: t[COLUMN_TYPE_LABEL[type]], type };
    if (type === "select" || type === "tags") newCol.options = [t.default_option_1, t.default_option_2];
    updateTable.mutate({ id: table.id, data: { column_config: [...table.column_config, newCol] } });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!rows || !over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    if (from === -1 || to === -1) return;
    reorderRows.mutate(arrayMove(rows, from, to).map((r) => r.id));
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
          <span className="cursor-pointer hover:text-accent-text" onDoubleClick={() => setEditingName(true)}>
            {table.name}
          </span>
        )}
      />

      {!collapsed && (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={(rows ?? []).map((r) => r.id)} strategy={verticalListSortingStrategy}>
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
                      className="hover:text-accent-text cursor-pointer"
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
                        onCancel={() => {
                          setEditingCol(null);
                          setColEditorPos(null);
                        }}
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
                    items={COLUMN_TYPES.map((type) => ({
                      label: t[COLUMN_TYPE_LABEL[type]],
                      onSelect: () => addColumn(type),
                    }))}
                  />
              </Table.ActionsTh>
            </Table.Head>
            <Table.Body>
              {(rows ?? []).map((row) => (
                <SortableRow key={row.id} id={row.id}>
                  {(handle) => (
                  <>
                  <Table.Td narrow>
                    {handle}
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
                  </>
                  )}
                </SortableRow>
              ))}
            </Table.Body>
          </Table>
          </SortableContext>
          </DndContext>
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

/** A row that drags by its handle (the first cell), as in LineItemsTable. */
function SortableRow({ id, children }: { id: number; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <Table.Row
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : undefined }}
    >
      {children(<DragHandle {...attributes} {...listeners} size={ICON_SIZE.control} />)}
    </Table.Row>
  );
}
