import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { Trash2, Check, Plus } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useAppStore } from "../../stores/app-store";
import { useCustomLists, useCustomListItems, useCreateCustomList, useUpdateCustomList, useDeleteCustomList, useSetCustomListItems } from "../../db/hooks/useCustomLists";
import { getStoredTagColor, normalizeTagColorName, TAG_COLOR_NAMES } from "../../lib/tagColors";
import { Button } from "../ui";

export function CustomListsManager() {
  const t = useT();
  const darkMode = useAppStore((s) => s.darkMode);
  const { data: lists } = useCustomLists();
  const createList = useCreateCustomList();
  const updateList = useUpdateCustomList();
  const deleteList = useDeleteCustomList();
  const setItems = useSetCustomListItems();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: items } = useCustomListItems(selectedId);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newListName, setNewListName] = useState("");
  const [addingList, setAddingList] = useState(false);

  // Local editable items for the selected list
  const [localItems, setLocalItems] = useState<{ value: string; color: string }[]>([]);
  const [newItemValue, setNewItemValue] = useState("");
  const [newItemColor, setNewItemColor] = useState("gray");
  const [dirty, setDirty] = useState(false);

  // Sync local items when selection or remote items change
  useEffect(() => {
    setLocalItems((items ?? []).map((i) => ({ value: i.value, color: i.color ?? "gray" })));
    setDirty(false);
  }, [items, selectedId]);

  const handleCreateList = async () => {
    const name = newListName.trim();
    if (!name) return;
    const id = await createList.mutateAsync(name);
    setNewListName("");
    setAddingList(false);
    setSelectedId(id);
    toast.success(t.list_created);
  };

  const handleDeleteList = async (id: number) => {
    const confirmed = await ask(t.delete_list_confirm, { kind: "warning" });
    if (!confirmed) return;
    await deleteList.mutateAsync(id);
    if (selectedId === id) setSelectedId(null);
    toast.success(t.list_deleted);
  };

  const commitRename = async () => {
    if (renamingId === null) return;
    const name = renameValue.trim();
    if (name) await updateList.mutateAsync({ id: renamingId, name });
    setRenamingId(null);
  };

  const addItem = () => {
    const val = newItemValue.trim();
    if (!val) return;
    setLocalItems([...localItems, { value: val, color: newItemColor }]);
    setNewItemValue("");
    setDirty(true);
  };

  const removeItem = (idx: number) => {
    setLocalItems(localItems.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateItemColor = (idx: number, color: string) => {
    const next = [...localItems];
    next[idx] = { ...next[idx], color };
    setLocalItems(next);
    setDirty(true);
  };

  const saveItems = async () => {
    if (selectedId === null) return;
    await setItems.mutateAsync({ listId: selectedId, items: localItems });
    setDirty(false);
    toast.success(t.list_saved);
  };

  const allLists = lists ?? [];

  return (
    <div className="flex gap-6 min-h-[320px]">
      {/* Left: list of custom lists */}
      <div className="w-48 shrink-0 border-r border-[var(--color-border-divider)] pr-4">
        <div className="space-y-px">
          {allLists.length === 0 && !addingList && (
            <p className="text-xs text-muted py-2">{t.no_lists}</p>
          )}
          {allLists.map((list) => (
            <div key={list.id} className={`flex items-center gap-1 rounded-md px-2 py-1.5 group cursor-pointer ${selectedId === list.id ? "bg-accent-light text-accent" : "hover:bg-[var(--color-hover-row)]"}`}>
              {renamingId === list.id ? (
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                  className="flex-1 text-xs bg-transparent border-b border-accent outline-none"
                  autoFocus
                />
              ) : (
                <span
                  className="flex-1 text-xs truncate"
                  onClick={() => setSelectedId(list.id)}
                  onDoubleClick={() => { setRenamingId(list.id); setRenameValue(list.name); }}
                >
                  {list.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleDeleteList(list.id)}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-[var(--color-danger-text)] shrink-0"
                aria-label={t.delete}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
        {addingList ? (
          <div className="mt-2 flex gap-1">
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateList(); if (e.key === "Escape") setAddingList(false); }}
              placeholder={t.list_name}
              className="flex-1 border border-[var(--color-input-border)] rounded-lg px-2 py-1 text-xs"
              autoFocus
            />
            <button type="button" onClick={handleCreateList} aria-label={t.create} className="px-2 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent-hover">
              <Check size={12} />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="link"
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => setAddingList(true)}
            className="mt-2 w-full px-2 py-1"
          >
            {t.new_list}
          </Button>
        )}
      </div>

      {/* Right: items for selected list */}
      <div className="flex-1">
        {selectedId === null ? (
          <p className="text-xs text-muted py-2">{allLists.length > 0 ? t.select_list_to_edit : ""}</p>
        ) : (
          <div>
            <div className="space-y-1.5 mb-3">
              {localItems.map((item, i) => {
                const c = getStoredTagColor(item.color, darkMode);
                return (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span
                      style={{ background: c.bg, color: c.text }}
                      className="inline-block max-w-full truncate align-middle px-2 py-0.5 rounded-full text-xs"
                    >
                      {item.value}
                    </span>
                  </div>
                  <select
                    value={normalizeTagColorName(item.color)}
                    onChange={(e) => updateItemColor(i, e.target.value)}
                    className="text-xs border border-[var(--color-border-divider)] rounded-lg px-1 py-1"
                  >
                    {TAG_COLOR_NAMES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeItem(i)} aria-label={t.delete} className="text-muted hover:text-[var(--color-danger-text)]">
                    <Trash2 size={12} />
                  </button>
                </div>
                );
              })}
            </div>
            <div className="flex gap-2 mb-3">
              <input
                value={newItemValue}
                onChange={(e) => setNewItemValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                placeholder={t.new_list_item}
                className="flex-1 border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm"
              />
              <select
                value={newItemColor}
                onChange={(e) => setNewItemColor(e.target.value)}
                className="text-sm border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5"
              >
                {TAG_COLOR_NAMES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button type="button" onClick={addItem} aria-label={t.new_list_item} className="p-1.5 text-muted hover:text-accent">
                <Plus size={16} />
              </button>
            </div>
            {dirty && (
              <button
                type="button"
                onClick={saveItems}
                className="px-3 py-1.5 bg-accent text-white text-xs rounded-md hover:bg-accent-hover"
              >
                {t.save}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
