import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, Link, Unlink } from "lucide-react";
import { Button } from "../ui";
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
  const colEditorRef = useRef<HTMLDivElement>(null);

  // Close on outside click — commits with whatever is currently in the
  // (parent-owned) editor state, same as the original NamedTable listener.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colEditorRef.current && !colEditorRef.current.contains(e.target as Node)) {
        onCommit();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCommit]);

  return createPortal(
    <div
      ref={colEditorRef}
      className="fixed z-[9999] bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] p-3 min-w-[200px]"
      style={{ top: pos.top, left: pos.left }}
    >
      <label className="block text-[10px] text-muted mb-1">{t.rename}</label>
      <input
        value={colName}
        onChange={(e) => setColName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit(); }}
        className="w-full border border-[var(--color-input-border)] rounded-lg px-2 py-1 text-xs mb-2"
        autoFocus
      />
      {(col.type === "select" || col.type === "tags") && (
        <>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-muted">{t.options ?? "Options"}</label>
            {colLinkedListId ? (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-accent flex items-center gap-0.5">
                  <Link size={9} />
                  {(customLists ?? []).find((l) => l.id === colLinkedListId)?.name ?? ""}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  icon={<Unlink size={12} />}
                  onClick={onUnlinkList}
                  className="text-muted hover:text-[var(--color-danger-text)]"
                >
                  {t.unlink_list}
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  icon={<Link size={12} />}
                  onClick={() => setShowImportListDropdown((v) => !v)}
                >
                  {t.import_from_list}
                </Button>
                {showImportListDropdown && (
                  <div className="absolute right-0 top-full mt-1 z-[10000] bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-lg shadow-lg py-1 min-w-[140px]">
                    {(customLists ?? []).length === 0 ? (
                      <p className="text-[10px] text-muted px-3 py-1">{t.no_lists}</p>
                    ) : (
                      (customLists ?? []).map((list) => (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => onImportFromList(list.id)}
                          className="w-full text-left px-3 py-1 text-xs hover:bg-[var(--color-hover-row)]"
                        >
                          {list.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {colOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-1 mb-1">
              <input
                value={opt}
                onChange={(e) => {
                  if (colLinkedListId) return; // read-only when linked
                  const next = [...colOptions];
                  next[i] = e.target.value;
                  setColOptions(next);
                }}
                readOnly={!!colLinkedListId}
                className={`flex-1 border border-[var(--color-input-border)] rounded-lg px-2 py-0.5 text-xs ${colLinkedListId ? "opacity-60 cursor-not-allowed" : ""}`}
              />
              {!colLinkedListId && (
                <button
                  type="button"
                  onClick={() => setColOptions(colOptions.filter((_, j) => j !== i))}
                  className="text-muted hover:text-[var(--color-danger-text)]"
                  aria-label={t.delete}
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          ))}
          {!colLinkedListId && (
            <>
              <Button
                type="button"
                variant="link"
                size="sm"
                icon={<Plus size={12} />}
                onClick={() => setColOptions([...colOptions, ""])}
              >
                {t.add_row}
              </Button>
              <div className="border-t border-[var(--color-border-divider)] mt-2 pt-2">
                {showSaveAsListInput ? (
                  <div className="flex gap-1">
                    <input
                      value={saveAsListName}
                      onChange={(e) => setSaveAsListName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSaveAsList(); if (e.key === "Escape") setShowSaveAsListInput(false); }}
                      placeholder={t.list_name}
                      className="flex-1 border border-[var(--color-input-border)] rounded-lg px-2 py-0.5 text-[10px]"
                      autoFocus
                    />
                    <button type="button" onClick={onSaveAsList} className="text-[10px] text-accent hover:underline">{t.save}</button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
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
        </>
      )}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border-divider)]">
        <button
          type="button"
          onClick={onDelete}
          className="text-[10px] text-[var(--color-danger-text)] hover:underline"
        >
          {t.delete_column}
        </button>
        <button
          type="button"
          onClick={onCommit}
          className="text-[10px] text-accent hover:underline"
        >
          {t.save}
        </button>
      </div>
    </div>,
    document.body
  );
}
