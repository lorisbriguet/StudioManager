import { useState, useEffect } from "react";
import { notify } from "../../lib/notify";
import { undoableFromStore } from "../../lib/undo";
import { Trash2, Plus, ListChecks } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useCustomLists, useCustomListItems, useCreateCustomList, useUpdateCustomList, useDeleteCustomList, useSetCustomListItems } from "../../db/hooks/useCustomLists";
import { AddRow, Button, IconButton, InlineRename, FormActions, FORM_GAP, EmptyState } from "../ui";
import { navItemClass } from "../ui/NavItem";
import { OptionsEditor } from "../shared/OptionsEditor";

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
  const [addingList, setAddingList] = useState(false);

  // Local editable items for the selected list
  const [localItems, setLocalItems] = useState<{ value: string; color: string }[]>([]);
  const [dirty, setDirty] = useState(false);

  // Sync local items when selection or remote items change
  useEffect(() => {
    setLocalItems((items ?? []).map((i) => ({ value: i.value, color: i.color ?? "gray" })));
    setDirty(false);
  }, [items, selectedId]);

  const handleCreateList = async (name: string) => {
    const id = await createList.mutateAsync(name);
    setAddingList(false);
    setSelectedId(id);
    notify.success(t.list_created);
  };

  // No question: Undo puts the list and its items back.
  const handleDeleteList = async (id: number) => {
    await deleteList.mutateAsync(id);
    if (selectedId === id) setSelectedId(null);
    undoableFromStore(t.list_deleted);
  };

  const commitRename = async (id: number, name: string) => {
    await updateList.mutateAsync({ id, name });
    setRenamingId(null);
  };

  const saveItems = async () => {
    if (selectedId === null) return;
    await setItems.mutateAsync({ listId: selectedId, items: localItems });
    setDirty(false);
    notify.success(t.list_saved);
  };

  const allLists = lists ?? [];

  return (
    <div className="flex gap-6 min-h-[320px]">
      {/* Left: list of custom lists */}
      <div className="w-48 shrink-0 border-r border-[var(--color-border-divider)] pr-4">
        <div className="space-y-px">
          {allLists.length === 0 && !addingList && (
            <EmptyState size="sm" message={t.no_lists} />
          )}
          {allLists.map((list) => (
            <div key={list.id} className={`${navItemClass({ active: selectedId === list.id })} group cursor-pointer`}>
              {renamingId === list.id ? (
                <InlineRename
                  value={list.name}
                  label={t.rename}
                  onSave={(name) => commitRename(list.id, name)}
                  onCancel={() => setRenamingId(null)}
                  className="flex-1 text-xs"
                />
              ) : (
                <span
                  className="flex-1 text-xs truncate"
                  onClick={() => setSelectedId(list.id)}
                  onDoubleClick={() => setRenamingId(list.id)}
                >
                  {list.name}
                </span>
              )}
              <IconButton icon={Trash2} label={t.delete} size="xs" tone="danger" reveal onClick={() => handleDeleteList(list.id)} />
            </div>
          ))}
        </div>
        {addingList ? (
          <AddRow
            className="mt-2"
            placeholder={t.list_name}
            buttonLabel={t.create}
            onAdd={handleCreateList}
            onKeyDown={(e) => { if (e.key === "Escape") setAddingList(false); }}
            autoFocus
          />
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
          allLists.length > 0 && <EmptyState size="sm" icon={ListChecks} message={t.select_list_to_edit} />
        ) : (
          <div className={`flex flex-col ${FORM_GAP}`}>
            <OptionsEditor
              options={localItems}
              onChange={(next) => {
                setLocalItems(next.map((i) => ({ value: i.value, color: i.color ?? "gray" })));
                setDirty(true);
              }}
              addLabel={t.new_list_item}
            />
            {dirty && (
              <FormActions>
                <Button variant="primary" onClick={saveItems}>
                  {t.save}
                </Button>
              </FormActions>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
