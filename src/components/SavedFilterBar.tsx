import { useState, useRef, useEffect } from "react";
import { Bookmark, Plus, X, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import {
  useSavedFilters,
  useCreateSavedFilter,
  useRenameSavedFilter,
  useDeleteSavedFilter,
} from "../db/hooks/useSavedFilters";
import { useT } from "../i18n/useT";
import type { SavedFilter } from "../types/saved-filter";

interface Props {
  page: string;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
  activeFilterId: number | null;
  onActiveChange: (id: number | null) => void;
}

export function SavedFilterBar({ page, currentFilters, onApply, activeFilterId, onActiveChange }: Props) {
  const t = useT();
  const { data: filters } = useSavedFilters(page);
  const createFilter = useCreateSavedFilter(page);
  const renameFilter = useRenameSavedFilter(page);
  const deleteFilter = useDeleteSavedFilter(page);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filter: SavedFilter } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  useEffect(() => {
    if (editingId != null) editInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  const handleSave = () => {
    const name = nameInput.trim();
    if (!name) return;
    createFilter.mutate(
      { name, filters: currentFilters },
      {
        onSuccess: (id) => {
          toast.success(t.filter_saved);
          onActiveChange(id);
          setNaming(false);
          setNameInput("");
        },
      }
    );
  };

  const handleRename = () => {
    if (editingId == null) return;
    const name = editName.trim();
    if (!name) return;
    renameFilter.mutate({ id: editingId, name }, {
      onSuccess: () => {
        setEditingId(null);
        setEditName("");
      },
    });
  };

  const handleDelete = (id: number) => {
    deleteFilter.mutate(id, {
      onSuccess: () => {
        if (activeFilterId === id) onActiveChange(null);
      },
    });
  };

  if (!filters || filters.length === 0) {
    return (
      <div className="flex items-center gap-2 mb-3">
        {naming ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setNaming(false); setNameInput(""); }
              }}
              placeholder={t.filter_name}
              className="text-xs px-2 py-1 border border-gray-200 rounded-md w-36 bg-transparent"
            />
            <button onClick={handleSave} className="text-xs text-accent hover:text-accent-hover px-1">{t.save}</button>
            <button onClick={() => { setNaming(false); setNameInput(""); }} className="text-muted hover:text-gray-700"><X size={12} /></button>
          </div>
        ) : (
          <button
            onClick={() => setNaming(true)}
            className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
          >
            <Bookmark size={12} />
            {t.save_filter}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      <button
        onClick={() => onActiveChange(null)}
        className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
          activeFilterId == null
            ? "bg-accent text-white"
            : "text-muted hover:bg-gray-100 dark:hover:bg-gray-200"
        }`}
      >
        {t.all}
      </button>

      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => {
            onActiveChange(f.id);
            onApply(f.filters);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, filter: f });
          }}
          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
            activeFilterId === f.id
              ? "bg-accent text-white"
              : "text-muted hover:bg-gray-100 dark:hover:bg-gray-200"
          }`}
        >
          {editingId === f.id ? (
            <input
              ref={editInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") { setEditingId(null); setEditName(""); }
              }}
              onBlur={handleRename}
              onClick={(e) => e.stopPropagation()}
              className="text-xs bg-transparent border-b border-accent w-20 outline-none"
            />
          ) : (
            f.name
          )}
        </button>
      ))}

      {naming ? (
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") { setNaming(false); setNameInput(""); }
            }}
            placeholder={t.filter_name}
            className="text-xs px-2 py-1 border border-gray-200 rounded-md w-28 bg-transparent"
          />
          <button onClick={handleSave} className="text-xs text-accent hover:text-accent-hover px-1">{t.save}</button>
          <button onClick={() => { setNaming(false); setNameInput(""); }} className="text-muted hover:text-gray-700"><X size={12} /></button>
        </div>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors px-1"
          title={t.save_filter}
        >
          <Plus size={12} />
        </button>
      )}

      {ctxMenu && createPortal(
        <div
          className="fixed z-50 bg-white dark:bg-gray-100 border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] animate-in"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-200"
            onClick={() => {
              setEditingId(ctxMenu.filter.id);
              setEditName(ctxMenu.filter.name);
              setCtxMenu(null);
            }}
          >
            <Pencil size={12} /> {t.rename}
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => {
              handleDelete(ctxMenu.filter.id);
              setCtxMenu(null);
            }}
          >
            <Trash2 size={12} /> {t.delete}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
