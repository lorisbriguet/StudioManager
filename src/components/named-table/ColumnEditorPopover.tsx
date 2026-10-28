import { useRef } from "react";
import { Plus, Trash2, Link, Unlink } from "lucide-react";
import { Button, Input, FormField, FormGroup, FormActions } from "../ui";
import { Popover } from "../ui/Popover";
import { MENU_ITEM } from "../ui/Dropdown";
import type { TableColumnDef } from "../../types/project-table";
import type { CustomList } from "../../db/queries/customLists";
import { IconButton } from "../ui/IconButton";

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
  showImportListDropdown: boolean;
  setShowImportListDropdown: (value: boolean | ((prev: boolean) => boolean)) => void;
  showSaveAsListInput: boolean;
  setShowSaveAsListInput: (value: boolean) => void;
  saveAsListName: string;
  setSaveAsListName: (value: string) => void;
  onImportFromList: (listId: number) => void;
  onUnlinkList: () => void;
  onSaveAsList: () => void;
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
  showImportListDropdown,
  setShowImportListDropdown,
  showSaveAsListInput,
  setShowSaveAsListInput,
  saveAsListName,
  setSaveAsListName,
  onImportFromList,
  onUnlinkList,
  onSaveAsList,
  onDelete,
  onCommit,
}: Props) {
  const importListAnchorRef = useRef<HTMLDivElement>(null);
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
        <FormGroup
          label={t.options ?? "Options"}
          action={colLinkedListId ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-accent flex items-center gap-0.5">
                  <Link size={11} />
                  {(customLists ?? []).find((l) => l.id === colLinkedListId)?.name ?? ""}
                </span>
                <Button
                  type="button"
                  variant="link"
                  icon={<Unlink size={12} />}
                  onClick={onUnlinkList}
                  className="text-muted hover:text-[var(--color-danger-text)]"
                >
                  {t.unlink_list}
                </Button>
              </div>
            ) : (
              <div ref={importListAnchorRef}>
                <Button
                  type="button"
                  variant="link"
                  icon={<Link size={12} />}
                  onClick={() => setShowImportListDropdown((v) => !v)}
                  aria-haspopup="dialog"
                  aria-expanded={showImportListDropdown}
                >
                  {t.import_from_list}
                </Button>
                {showImportListDropdown && (
                  // Nested panel: a pick here does not close (and commit) the column editor.
                  <Popover
                    anchor={importListAnchorRef}
                    align="end"
                    onClose={(returnFocus) => {
                      setShowImportListDropdown(false);
                      if (returnFocus) importListAnchorRef.current?.querySelector("button")?.focus({ preventScroll: true });
                    }}
                  >
                    {(customLists ?? []).length === 0 ? (
                      <p className="text-xs text-muted px-2 py-1">{t.no_lists}</p>
                    ) : (
                      (customLists ?? []).map((list) => (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => onImportFromList(list.id)}
                          className={`${MENU_ITEM} cursor-pointer text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text)]`}
                        >
                          {list.name}
                        </button>
                      ))
                    )}
                  </Popover>
                )}
              </div>
            )}
        >
          {colOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-1 mb-1">
              <Input size="sm" fullWidth={false}
                value={opt}
                onChange={(e) => {
                  if (colLinkedListId) return; // read-only when linked
                  const next = [...colOptions];
                  next[i] = e.target.value;
                  setColOptions(next);
                }}
                readOnly={!!colLinkedListId}
                className={`flex-1 ${colLinkedListId ? "opacity-60 cursor-not-allowed" : ""}`}
              />
              {!colLinkedListId && (
                <IconButton
                  icon={Trash2}
                  label={t.delete}
                  size="xs"
                  tone="danger"
                  onClick={() => setColOptions(colOptions.filter((_, j) => j !== i))}
                />
              )}
            </div>
          ))}
          {!colLinkedListId && (
            <>
              <Button
                type="button"
                variant="link"
                icon={<Plus size={12} />}
                onClick={() => setColOptions([...colOptions, ""])}
              >
                {t.add_row}
              </Button>
              <div className="border-t border-[var(--color-border-divider)] mt-2 pt-2">
                {showSaveAsListInput ? (
                  <div className="flex gap-2">
                    <Input size="sm" fullWidth={false}
                      value={saveAsListName}
                      onChange={(e) => setSaveAsListName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSaveAsList(); if (e.key === "Escape") { e.preventDefault(); setShowSaveAsListInput(false); } }}
                      placeholder={t.list_name}
                      aria-label={t.list_name}
                      className="flex-1"
                      autoFocus
                    />
                    <Button type="button" onClick={onSaveAsList}>{t.save}</Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    icon={<Link size={12} />}
                    onClick={() => setShowSaveAsListInput(true)}
                    className="text-muted hover:text-accent"
                  >
                    {t.save_as_list}
                  </Button>
                )}
              </div>
            </>
          )}
        </FormGroup>
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
