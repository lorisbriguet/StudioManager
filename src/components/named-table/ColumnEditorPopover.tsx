import { Button, Input, FormField, FormActions } from "../ui";
import { Popover } from "../ui/Popover";
import { OptionsEditor } from "../shared/OptionsEditor";
import type { TableColumnDef } from "../../types/project-table";
import type { CustomList } from "../../db/queries/customLists";

interface Props {
  col: TableColumnDef;
  pos: { top: number; left: number };
  t: Record<string, string>;
  colName: string;
  setColName: (value: string) => void;
  colOptions: string[];
  setColOptions: (options: string[]) => void;
  colLinkedListId: number | undefined;
  customLists: CustomList[] | undefined;
  onImportFromList: (listId: number) => void;
  onUnlinkList: () => void;
  onSaveAsList: (name: string) => void | Promise<void>;
  onDelete: () => void;
  onCommit: () => void;
}

/** The column-editor popover — rename, options (for select/tags columns,
 * with optional linking to a saved custom list), delete and save. Extracted
 * verbatim out of NamedTable's column header cell, including its
 * outside-click-commits behaviour, which now lives here since the popover
 * only ever mounts while it is open. */
export function ColumnEditorPopover({
  col,
  pos,
  t,
  colName,
  setColName,
  colOptions,
  setColOptions,
  colLinkedListId,
  customLists,
  onImportFromList,
  onUnlinkList,
  onSaveAsList,
  onDelete,
  onCommit,
}: Props) {
  // Closing (outside click or Esc) commits with whatever is currently in the
  // (parent-owned) editor state, same as the original NamedTable listener.
  return (
    <Popover
      at={{ x: pos.left, y: pos.top }}
      onClose={onCommit}
      padding="content"
      autoFocus={false}
      className="min-w-[200px]"
    >
      <FormField label={t.rename} className="mb-3">
        <Input size="sm"
          value={colName}
          onChange={(e) => setColName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onCommit(); }}
          autoFocus
        />
      </FormField>
      {(col.type === "select" || col.type === "tags") && (
        // Named-table options are plain names: no colours, renamed in place.
        <OptionsEditor
          label={t.options}
          colors={false}
          options={colOptions.map((value) => ({ value }))}
          onChange={(next) => setColOptions(next.map((o) => o.value))}
          lists={customLists}
          linkedListId={colLinkedListId}
          onLink={onImportFromList}
          onUnlink={onUnlinkList}
          onSaveAsList={onSaveAsList}
        />
      )}
      <FormActions
        className="mt-3 pt-3 border-t border-[var(--color-border-divider)]"
        destructive={
          <Button type="button" variant="danger" onClick={onDelete}>
            {t.delete_column}
          </Button>
        }
      >
        <Button type="button" onClick={onCommit}>
          {t.save}
        </Button>
      </FormActions>
    </Popover>
  );
}
