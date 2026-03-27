import { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, Search, ExternalLink, Trash2, X, Tag } from "lucide-react";
import { PageHeader, Button, PageSpinner, EmptyState } from "../components/ui";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  useResources,
  useAllTags,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
} from "../db/hooks/useResources";
import { getResourceTags } from "../db/queries/resources";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useT } from "../i18n/useT";
import { logError } from "../lib/log";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions } from "../types/saved-filter";

type SortKey = "name" | "price";

interface ResourceRow {
  id: number;
  name: string;
  url: string;
  price: string;
  tags: string[];
}

export function ResourcesPage() {
  const t = useT();
  const { data: resources, isLoading } = useResources();
  const { data: allTags } = useAllTags();
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "name", dir: "asc" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<ResourceRow> | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    setTagFilter(typeof filters.tagFilter === "string" ? filters.tagFilter : null);
    setFilterConditions(filters.conditions ?? []);
  }, []);

  const resourceFields = useMemo<FilterableField[]>(() => [
    { key: "name", label: t.name, type: "string" },
    { key: "price", label: "Price", type: "string" },
  ], [t]);

  // Build rows with tags
  const [rows, setRows] = useState<ResourceRow[]>([]);
  useEffect(() => {
    if (!resources) return;
    let cancelled = false;
    (async () => {
      const result: ResourceRow[] = [];
      for (const r of resources) {
        const tags = await getResourceTags(r.id);
        result.push({ ...r, tags: tags.map((t) => t.tag) });
      }
      if (!cancelled) setRows(result);
    })();
    return () => { cancelled = true; };
  }, [resources]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (tagFilter) {
      list = list.filter((r) => r.tags.includes(tagFilter));
    }
    list = applyFilterConditions(list, filterConditions);
    return sortRows(list, sort.key, sort.dir);
  }, [rows, search, tagFilter, sort, filterConditions]);

  const bulk = useBulkSelect(filtered);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as number[];
    ids.forEach((id) => deleteResource.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteResource, t]);

  const handleDelete = async (id: number, name: string) => {
    try {
      await deleteResource.mutateAsync(id);
      toast.success(`${t.delete}: ${name}`);
    } catch (err) {
      logError("Delete resource failed:", err);
      toast.error("Delete failed");
    }
  };

  const handleOpenUrl = (url: string) => {
    let u = url;
    if (u && !u.startsWith("http://") && !u.startsWith("https://")) {
      u = "https://" + u;
    }
    openUrl(u).catch((err) => {
      logError("Open URL failed:", err);
      toast.error("Failed to open URL");
    });
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      <PageHeader title={t.resources}>
        <Button icon={<Plus size={14} />} onClick={() => setShowForm(!showForm)}>
          {t.new_resource}
        </Button>
      </PageHeader>

      {showForm && (
        <NewResourceForm
          allTags={allTags ?? []}
          onSubmit={async (data) => {
            try {
              await createResource.mutateAsync(data);
              setShowForm(false);
              toast.success(t.save);
            } catch (err) {
              logError("Create resource failed:", err);
              toast.error("Create failed");
            }
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Search + tag filter */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder={t.search_resources}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setActiveFilterId(null); }}
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm"
          />
        </div>
        {(allTags ?? []).length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag size={14} className="text-muted" />
            {tagFilter && (
              <button
                onClick={() => { setTagFilter(null); setActiveFilterId(null); }}
                className="px-2 py-0.5 text-xs rounded-full bg-accent text-white flex items-center gap-1"
              >
                {tagFilter} <X size={10} />
              </button>
            )}
            {!tagFilter &&
              (allTags ?? []).map((tag) => (
                <button
                  key={tag}
                  onClick={() => { setTagFilter(tag); setActiveFilterId(null); }}
                  className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  {tag}
                </button>
              ))}
          </div>
        )}
      </div>

      <SavedFilterBar
        page="resources"
        currentFilters={{ search, tagFilter: tagFilter ?? undefined, conditions: filterConditions }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={resourceFields}
      />

      {filtered.length === 0 ? (
        <EmptyState message={rows.length === 0 ? t.no_resources_yet : t.no_matching_resources} />
      ) : (
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={bulk.isAllSelected} onChange={bulk.toggleAll} className="accent-[var(--accent)]" />
                </th>
                <SortHeader<SortKey> label={t.name} sortKey="name" current={sort} onSort={setSort} />
                <th className="text-left px-3 py-2 font-medium text-xs text-muted">{t.type}</th>
                <SortHeader<SortKey> label={t.price_label} sortKey="price" current={sort} onSort={setSort} />
                <th className="text-left px-3 py-2 font-medium text-xs text-muted">{t.link}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <ResourceTableRow
                  key={r.id}
                  resource={r}
                  allTags={allTags ?? []}
                  isEditing={editingId === r.id}
                  isSelected={bulk.selected.has(r.id)}
                  onToggleSelect={(shiftKey) => bulk.toggleItem(r.id, shiftKey)}
                  onStartEdit={() => setEditingId(r.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={async (data, tags) => {
                    try {
                      await updateResource.mutateAsync({ id: r.id, data, tags });
                      setEditingId(null);
                      toast.success(t.save);
                    } catch (err) {
                      logError("Update resource failed:", err);
                      toast.error("Update failed");
                    }
                  }}
                  onDelete={() => handleDelete(r.id, r.name)}
                  onOpenUrl={() => handleOpenUrl(r.url)}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: r }); }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-muted mt-3">
        {filtered.length} {filtered.length === 1 ? t.resources_count_singular : t.resources_count_plural}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            ...(ctxMenu.item.url ? [{ label: t.open_link, icon: <ExternalLink size={14} />, onClick: () => handleOpenUrl(ctxMenu.item.url) }] : []),
            { label: t.edit, onClick: () => setEditingId(ctxMenu.item.id) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => handleDelete(ctxMenu.item.id, ctxMenu.item.name) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

function NewResourceForm({
  allTags,
  onSubmit,
  onCancel,
}: {
  allTags: string[];
  onSubmit: (data: { name: string; url: string; price: string; tags: string[] }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  return (
    <div className="border border-gray-100 rounded-lg p-4 mb-4 bg-gray-50">
      <div className="grid grid-cols-4 gap-3">
        <input
          type="text"
          placeholder={t.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm"
          autoFocus
        />
        <input
          type="text"
          placeholder="URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm"
        />
        <select
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">{t.price_label}</option>
          <option value="free">{t.price_free}</option>
          <option value="paid">{t.price_paid}</option>
        </select>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={t.add_tag}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              list="tag-suggestions"
              className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm"
            />
            <datalist id="tag-suggestions">
              {allTags.filter((t) => !tags.includes(t)).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-full bg-accent-light text-accent flex items-center gap-1"
            >
              {tag}
              <button onClick={() => setTags(tags.filter((t) => t !== tag))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => {
            if (!name.trim()) return;
            onSubmit({ name: name.trim(), url: url.trim(), price, tags });
          }}
          disabled={!name.trim()}
          className="px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50"
        >
          {t.save}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-muted hover:text-gray-900 dark:hover:text-gray-200">
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

function ResourceTableRow({
  resource,
  allTags,
  isEditing,
  isSelected,
  onToggleSelect,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onOpenUrl,
  onContextMenu,
}: {
  resource: ResourceRow;
  allTags: string[];
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: Partial<{ name: string; url: string; price: string }>, tags?: string[]) => void;
  onDelete: () => void;
  onOpenUrl: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  const [name, setName] = useState(resource.name);
  const [url, setUrl] = useState(resource.url);
  const [price, setPrice] = useState(resource.price);
  const [tags, setTags] = useState(resource.tags);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    setName(resource.name);
    setUrl(resource.url);
    setPrice(resource.price);
    setTags(resource.tags);
  }, [resource, isEditing]);

  if (isEditing) {
    return (
      <tr className="border-b border-gray-100 bg-accent-light/30">
        <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onToggleSelect(e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
            className="accent-[var(--accent)]"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
            autoFocus
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1 items-center">
            {tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-accent-light text-accent flex items-center gap-1">
                {tag}
                <button onClick={() => setTags(tags.filter((t) => t !== tag))}><X size={10} /></button>
              </span>
            ))}
            <input
              type="text"
              placeholder={t.add_tag}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const trimmed = tagInput.trim();
                  if (trimmed && !tags.includes(trimmed)) setTags([...tags, trimmed]);
                  setTagInput("");
                }
              }}
              list={`edit-tag-suggestions-${resource.id}`}
              className="border-none outline-none text-xs w-16 bg-transparent"
            />
            <datalist id={`edit-tag-suggestions-${resource.id}`}>
              {allTags.filter((t) => !tags.includes(t)).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </td>
        <td className="px-3 py-2">
          <select value={price} onChange={(e) => setPrice(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-sm">
            <option value="">—</option>
            <option value="free">{t.price_free}</option>
            <option value="paid">{t.price_paid}</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <button
              onClick={() => onSave({ name, url, price }, tags)}
              className="text-xs text-accent hover:underline"
            >
              {t.save}
            </button>
            <button onClick={onCancelEdit} className="text-xs text-muted hover:text-gray-900 dark:hover:text-gray-200">
              {t.cancel}
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-200 group cursor-pointer"
      onDoubleClick={onStartEdit}
      onContextMenu={onContextMenu}
    >
      <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
          className="accent-[var(--accent)]"
        />
      </td>
      <td className="px-3 py-2 font-medium">{resource.name}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {resource.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2">
        {resource.price && (
          <span className={`px-2 py-0.5 text-xs rounded-full ${
            resource.price === "free"
              ? "bg-green-100 text-green-700"
              : "bg-orange-100 text-orange-700"
          }`}>
            {resource.price === "free" ? t.price_free : t.price_paid}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {resource.url && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenUrl(); }}
            className="flex items-center gap-1 text-accent hover:underline text-xs max-w-[300px] truncate"
          >
            <ExternalLink size={12} />
            {resource.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </button>
        )}
      </td>
      <td className="px-3 py-2">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-danger opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}
