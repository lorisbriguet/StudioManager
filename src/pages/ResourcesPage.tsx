import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ICONS, ICON_SIZE, PageHeader, Button, EmptyState, QueryState, NoResults, FormField, Select, IconButton, Tag, FilterChip, Input, Callout, FormGrid, FormModal, Table, TableSkeleton, SearchBar } from "../components/ui";
import { TagInput } from "../components/shared/TagInput";
import * as v from "../lib/validate";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { notify } from "../lib/notify";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  useResources,
  useAllTags,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
} from "../db/hooks/useResources";
import { getResourceTags } from "../db/queries/resources";
import { SortHeader, sortRows, type SortState } from "../components/ui/SortHeader";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useBulkDelete } from "../hooks/useBulkDelete";
import { useT } from "../i18n/useT";
import { undoableFromStore, undoTop } from "../lib/undo";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

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
  const resourcesQuery = useResources();
  const { data: resources } = resourcesQuery;
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
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    setTagFilter(typeof filters.tagFilter === "string" ? filters.tagFilter : null);
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const resourceFields = useMemo<FilterableField[]>(() => [
    { key: "name", label: t.name, type: "string" },
    { key: "price", label: t.price_label, type: "select", options: [{ value: "free", label: t.price_free }, { value: "paid", label: t.price_paid }] },
    { key: "tags", label: t.tags, type: "select", options: (allTags ?? []).map((tag) => ({ value: tag, label: tag })) },
  ], [t, allTags]);

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
    list = applyFilterConditions(list, filterConditions, filterLogic);
    return sortRows(list, sort.key, sort.dir);
  }, [rows, search, tagFilter, sort, filterConditions, filterLogic]);

  const bulk = useBulkSelect(filtered);

  const deleteSelection = useBulkDelete("resources", (id: number) => deleteResource.mutateAsync(id));
  const bulkDelete = () => void deleteSelection([...bulk.selected] as number[], bulk.clearSelection);

  const handleDelete = async (id: number) => {
    const before = undoTop();
    try {
      await deleteResource.mutateAsync(id);
      undoableFromStore(t.toast_resource_deleted, before);
    } catch {
      // reported by the mutation
    }
  };

  const handleOpenUrl = (url: string) => {
    let u = url;
    if (u && !u.startsWith("http://") && !u.startsWith("https://")) {
      u = "https://" + u;
    }
    openUrl(u).catch((err) => {
      notify.error(t.failed_to_open_url, err);
    });
  };

  const clearFilters = () => {
    setSearch("");
    setTagFilter(null);
    setFilterConditions([]);
    setActiveFilterId(null);
  };

  return (
    <div>
      <PageHeader title={t.resources}>
        <Button icon={ICONS.add} onClick={() => setShowForm(!showForm)}>
          {t.new_resource}
        </Button>
      </PageHeader>

      {showForm && (
        <NewResourceForm
          allTags={allTags ?? []}
          existingUrls={rows.map((r) => ({ url: r.url, name: r.name }))}
          saving={createResource.isPending}
          onSubmit={async (data) => {
            try {
              await createResource.mutateAsync(data);
              setShowForm(false);
              notify.success(t.resource_saved);
            } catch {
              // reported by the mutation
            }
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Search + tag filter */}
      <div className="flex items-center gap-3 mb-4">
        <SearchBar
          placeholder={t.search_resources}
          value={search}
          onChange={(v) => { setSearch(v); setActiveFilterId(null); }}
          className="flex-1 max-w-xs"
        />
        {(allTags ?? []).length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {(allTags ?? []).map((tag) => {
              const active = tagFilter === tag;
              return (
                <FilterChip
                  key={tag}
                  tag={tag}
                  active={active}
                  activeIcon={<ICONS.close size={ICON_SIZE.pill} />}
                  onClick={() => { setTagFilter(active ? null : tag); setActiveFilterId(null); }}
                />
              );
            })}
          </div>
        )}
      </div>

      <SavedFilterBar
        page="resources"
        currentFilters={{ search, tagFilter: tagFilter ?? undefined, conditions: filterConditions, conditionLogic: filterLogic }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={resourceFields}
      />

      <QueryState query={resourcesQuery} skeleton={<TableSkeleton columns={6} />} errorMessage={t.load_error_resources}>
      {() => (
      <Table>
        <Table.Head>
          <Table.SelectAll all={bulk.isAllSelected} some={bulk.selected.size > 0} onToggle={bulk.toggleAll} label={t.select_all} />
          <SortHeader<SortKey> label={t.name} sortKey="name" current={sort} onSort={setSort} />
          <Table.Th>{t.type}</Table.Th>
          <SortHeader<SortKey> label={t.price_label} sortKey="price" current={sort} onSort={setSort} />
          <Table.Th>{t.link}</Table.Th>
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
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
                  notify.success(t.resource_saved);
                } catch {
                  // reported by the mutation
                }
              }}
              onDelete={() => handleDelete(r.id)}
              onOpenUrl={() => handleOpenUrl(r.url)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: r }); }}
            />
          ))}
          {filtered.length === 0 && (
            <Table.Empty colSpan={6}>
              {rows.length === 0 ? (
                <EmptyState
                  icon={ICONS.resource}
                  message={t.no_resources_yet}
                  action={
                    <Button icon={ICONS.add} onClick={() => setShowForm(true)}>
                      {t.new_resource}
                    </Button>
                  }
                />
              ) : (
                <NoResults message={t.no_matching_resources} onClear={clearFilters} />
              )}
            </Table.Empty>
          )}
        </Table.Body>
      </Table>
      )}
      </QueryState>

      <div className="text-xs text-muted mt-3">
        {filtered.length} {filtered.length === 1 ? t.resources_count_singular : t.resources_count_plural}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            ...(ctxMenu.item.url ? [{ label: t.open_link, icon: ICONS.openExternal, onClick: () => handleOpenUrl(ctxMenu.item.url) }] : []),
            { label: t.edit, onClick: () => setEditingId(ctxMenu.item.id) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => handleDelete(ctxMenu.item.id) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.delete, icon: ICONS.delete, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

// Phase 2 E3 — inline validation (E1 pattern) for the new-resource form.
type ResourceFormField = "name" | "url";

// Mirrors handleOpenUrl's normalization: bare domains are opened as https://.
const lenientUrl: v.Rule = (value) => {
  const s = value.trim();
  if (!s) return null;
  return v.url(s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`);
};

const resourceSchema: v.FormSchema<ResourceFormField> = {
  name: [v.required],
  url: [v.required, lenientUrl],
};

function NewResourceForm({
  allTags,
  existingUrls,
  onSubmit,
  onCancel,
  saving,
}: {
  allTags: string[];
  existingUrls: { url: string; name: string }[];
  onSubmit: (data: { name: string; url: string; price: string; tags: string[] }) => void;
  onCancel: () => void;
  /** The create is in flight: blocks a second Save / Enter. */
  saving: boolean;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<ResourceFormField, string>>>({});
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<{ name: string; url: string; price: string; tags: string[] } | null>(null);

  const setFieldError = (field: ResourceFormField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });

  const validateOnBlur = (field: ResourceFormField) =>
    setFieldError(field, v.validateField(field === "name" ? name : url, resourceSchema[field]));

  const clearError = (field: ResourceFormField) => setFieldError(field, null);

  const normalizeUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

  const checkDuplicate = (submitData: { name: string; url: string; price: string; tags: string[] }) => {
    if (submitData.url.trim()) {
      const normalized = normalizeUrl(submitData.url);
      const existing = existingUrls.find((r) => normalizeUrl(r.url) === normalized);
      if (existing) {
        setDuplicateWarning(existing.name);
        setPendingSubmit(submitData);
        return true;
      }
    }
    return false;
  };

  const submit = () => {
    const errs = v.validateForm({ name, url }, resourceSchema);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const data = { name: name.trim(), url: url.trim(), price, tags };
    if (!checkDuplicate(data)) {
      onSubmit(data);
    }
  };

  return (
    <FormModal open onClose={onCancel} title={t.new_resource} submitLabel={t.save} onSubmit={submit} submitting={saving}>
      <FormGrid cols={2}>
        <FormField label={t.name} required error={errors.name}>
          <Input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); clearError("name"); }}
            onBlur={() => validateOnBlur("name")}
            autoFocus
          />
        </FormField>
        <FormField label={t.url_label} required error={errors.url}>
          <Input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); clearError("url"); }}
            onBlur={() => validateOnBlur("url")}
          />
        </FormField>
        <FormField label={t.price_label}>
          <Select
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          >
            <option value="">{t.price_label}</option>
            <option value="free">{t.price_free}</option>
            <option value="paid">{t.price_paid}</option>
          </Select>
        </FormField>
        <FormField label={t.tags}>
          <TagInput value={tags} onChange={setTags} suggestions={allTags} />
        </FormField>
      </FormGrid>
      {duplicateWarning && (
        <Callout
          tone="warning"
          action={
            <>
              <Button
                onClick={() => { if (pendingSubmit) { onSubmit(pendingSubmit); } setDuplicateWarning(null); setPendingSubmit(null); }}
              >
                {t.save_anyway}
              </Button>
              <Button variant="secondary" onClick={() => { setDuplicateWarning(null); setPendingSubmit(null); }}>
                {t.cancel}
              </Button>
            </>
          }
        >
          <span className="font-medium">{t.possible_duplicate}:</span>{" "}
          {t.resource_duplicate_warning.replace("{name}", duplicateWarning)}
        </Callout>
      )}
    </FormModal>
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
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setName(resource.name);
    setUrl(resource.url);
    setPrice(resource.price);
    setTags(resource.tags);
  }, [resource, isEditing]);

  // Clean up blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const doSave = useCallback(() => {
    if (savingRef.current) return;
    savingRef.current = true;
    onSave({ name, url, price }, tags);
    // Reset after a tick so the flag doesn't block future edits
    setTimeout(() => { savingRef.current = false; }, 100);
  }, [name, url, price, tags, onSave]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTableRowElement>) => {
    // If focus moves to another element inside the same row, don't save
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    // Small delay to allow explicit Save/Cancel button clicks to fire first
    blurTimeoutRef.current = setTimeout(() => {
      doSave();
    }, 150);
  }, [doSave]);

  const handleFocus = useCallback(() => {
    // Cancel pending blur-save when focus returns inside the row
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  if (isEditing) {
    return (
      <Table.Row
        selected={isSelected}
        className="bg-accent-tint"
        onBlur={handleBlur}
        onFocus={handleFocus}
      >
        <Table.Select checked={isSelected} onToggle={onToggleSelect} label={t.select_row.replace("{name}", resource.name)} />
        <Table.Td>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t.name}
            autoFocus
          />
        </Table.Td>
        <Table.Td>
          <TagInput value={tags} onChange={setTags} suggestions={allTags} variant="bare" width="xs" />
        </Table.Td>
        <Table.Td>
          <Select value={price} onChange={(e) => setPrice(e.target.value)} fullWidth={false} aria-label={t.price_label}>
            <option value="">—</option>
            <option value="free">{t.price_free}</option>
            <option value="paid">{t.price_paid}</option>
          </Select>
        </Table.Td>
        <Table.Td>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label={t.url_label}
          />
        </Table.Td>
        <Table.Actions always>
          <IconButton size="xs" icon={ICONS.save} label={t.save} color="accent" onClick={() => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); doSave(); }} />
          <IconButton size="xs" icon={ICONS.close} label={t.cancel} onClick={() => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); onCancelEdit(); }} />
        </Table.Actions>
      </Table.Row>
    );
  }

  return (
    <Table.Row
      selected={isSelected}
      onOpen={onStartEdit}
      onContextMenu={onContextMenu}
    >
      <Table.Select checked={isSelected} onToggle={onToggleSelect} label={t.select_row.replace("{name}", resource.name)} />
      <Table.Td className="font-medium">{resource.name}</Table.Td>
      <Table.Td>
        <TagInput value={resource.tags} onChange={() => {}} readOnly />
      </Table.Td>
      <Table.Td>
        {resource.price && (
          <Tag name={resource.price} color={resource.price === "free" ? "green" : "red"}>
            {resource.price === "free" ? t.price_free : t.price_paid}
          </Tag>
        )}
      </Table.Td>
      <Table.Td>
        {resource.url && (
          <Button
            variant="link"
            icon={ICONS.openExternal}
            onClick={onOpenUrl}
            className="max-w-[300px] truncate"
          >
            {resource.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </Button>
        )}
      </Table.Td>
      <Table.Actions>
        <IconButton size="xs"
          icon={ICONS.delete}
          label={t.delete}
          tone="danger"
          onClick={onDelete}
        />
      </Table.Actions>
    </Table.Row>
  );
}
