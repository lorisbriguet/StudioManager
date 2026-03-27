import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { X, Plus, Pin, ChevronLeft, ChevronRight } from "lucide-react";
import { useTabStore, type Tab } from "../../stores/tab-store";

function TabItem({ tab, isActive, onActivate, onClose, onMiddleClick }: {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onMiddleClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onMiddleClick(); } }}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm shrink-0 border-b-2 transition-colors group ${
        isActive
          ? "border-accent text-accent font-medium"
          : "border-transparent text-muted hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-200"
      }`}
    >
      {tab.pinned && <Pin size={10} className="text-muted shrink-0" />}
      <span className="max-w-[120px] truncate">{tab.label}</span>
      {!tab.pinned && (
        <span
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="opacity-0 group-hover:opacity-100 hover:text-red-600 shrink-0 ml-0.5"
        >
          <X size={12} />
        </span>
      )}
    </button>
  );
}

export function TabBar() {
  const { tabs, activeTabId, openTab, closeTab, activateTab } = useTabStore();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track back/forward availability via react-router's history.state.idx
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const updateNavState = useCallback(() => {
    // history.state?.idx is set by react-router and tracks position in the history stack
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    setCanGoBack(idx > 0);
    // We track max index seen to know if forward is possible
    const maxKey = "nav_max_idx";
    const storedMax = Number(sessionStorage.getItem(maxKey) || "0");
    const newMax = Math.max(storedMax, idx);
    sessionStorage.setItem(maxKey, String(newMax));
    setCanGoForward(idx < newMax);
  }, []);

  useEffect(() => {
    updateNavState();
  }, [location, updateNavState]);

  useEffect(() => {
    const handler = () => updateNavState();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [updateNavState]);

  // Don't show tab bar when only 1 tab
  if (tabs.length <= 1) return null;

  const handleActivate = (tab: Tab) => {
    activateTab(tab.id);
    navigate(tab.path);
  };

  const handleClose = (tab: Tab) => {
    const newActiveId = closeTab(tab.id);
    if (newActiveId) {
      const newActive = useTabStore.getState().tabs.find((t) => t.id === newActiveId);
      if (newActive) navigate(newActive.path);
    }
  };

  const handleNewTab = () => {
    const id = openTab("/", "Dashboard");
    if (id) navigate("/");
  };

  return (
    <div className="flex items-center border-b border-gray-200 bg-white dark:bg-gray-100 shrink-0" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Back / Forward navigation */}
      <div className="flex items-center shrink-0 ml-1.5 gap-0.5">
        <button
          type="button"
          disabled={!canGoBack}
          onClick={() => navigate(-1)}
          className="p-1 rounded text-muted hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Back"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          onClick={() => navigate(1)}
          className="p-1 rounded text-muted hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Forward"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex items-center flex-1 overflow-x-auto scrollbar-hide"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => handleActivate(tab)}
            onClose={() => handleClose(tab)}
            onMiddleClick={() => handleClose(tab)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={handleNewTab}
        className="shrink-0 p-1.5 mx-1 text-muted hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-200 rounded"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
