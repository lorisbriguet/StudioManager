import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { Trash2, Check, Plus } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useCustomLists, useCustomListItems, useCreateCustomList, useUpdateCustomList, useDeleteCustomList, useSetCustomListItems } from "../../db/hooks/useCustomLists";
import { normalizeTagColorName, TAG_COLOR_NAMES } from "../../lib/tagColors";
import { Button, Select, IconButton, Tag, Input } from "../ui";
import { navItemClass } from "../ui/NavItem";

export function CustomListsManager() {
  const t = useT();
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
            <div key={list.id} className={`${navItemClass({ active: selectedId === list.id })} group cursor-pointer`}>
              {renamingId === list.id ? (
                <Input variant="inline" fullWidth={false}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                  className="flex-1"
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
              <IconButton icon={Trash2} label={t.delete} size="xs" iconSize={11} tone="danger" reveal onClick={() => handleDeleteList(list.id)} />
            </div>
          ))}
        </div>
        {addingList ? (
          <div className="mt-2 flex gap-1">
            <Input size="sm" fullWidth={false}
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateList(); if (e.key === "Escape") setAddingList(false); }}
              placeholder={t.list_name}
              className="flex-1"
              autoFocus
            />
            <IconButton icon={Check} label={t.create} iconSize={12} filled onClick={handleCreateList} />
          </div>
        ) : (
          <Button
            type="button"
            variant="link"
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
                return (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Tag name={item.value} color={item.color} />
                  </div>
                  <Select
                    value={normalizeTagColorName(item.color)}
                    onChange={(e) => updateItemColor(i, e.target.value)}
                    fullWidth={false}
                  >
                    {TAG_COLOR_NAMES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                  <IconButton icon={Trash2} label={t.delete} size="xs" tone="danger" onClick={() => removeItem(i)} />
                </div>
                );
              })}
            </div>
            <div className="flex gap-2 mb-3">
              <Input size="sm" fullWidth={false}
                value={newItemValue}
                onChange={(e) => setNewItemValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                placeholder={t.new_list_item}
                className="flex-1"
              />
              <Select
                value={newItemColor}
                onChange={(e) => setNewItemColor(e.target.value)}
                fullWidth={false}
              >
                {TAG_COLOR_NAMES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
              <IconButton icon={Plus} label={t.new_list_item} size="md" tone="accent" onClick={addItem} />
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
