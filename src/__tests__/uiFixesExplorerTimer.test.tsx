import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WikiExplorer } from "../components/wiki/WikiExplorer";
import { QuickTimerModal } from "../components/QuickTimerModal";
import { projectColors } from "../components/wiki/wikiColors";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import type { WikiArticleWithTags } from "../types/wiki";

// UI review fixes: the wiki explorer's keyboard-reachable row menu (C14) and
// the quick timer's pickers built on Popover + MenuItem (B10).

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  localStorage.clear();
  await getDb();
  useAppStore.setState({ language: "EN" });
  setSelectHandler(() => []);
});
afterEach(() => {
  cleanup();
  setSelectHandler(null);
});

describe("wiki explorer row menu", () => {
  const article: WikiArticleWithTags = {
    id: 7, title: "Loose", content: "", project_id: null, folder_id: null, sort_order: 0,
    created_at: "", updated_at: "", tags: [],
  };

  it("offers the right-click items behind a 'more' button on each row", () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    wrap(
      <WikiExplorer
        articles={[article]}
        docs={[]}
        activeRef={null}
        colors={projectColors([])}
        onOpen={onOpen}
        onNewArticle={() => {}}
        onOpenGraph={() => {}}
        onDeleteArticle={onDelete}
      />
    );
    // Open the group so the article row shows
    fireEvent.click(screen.getAllByRole("treeitem")[0]);
    const more = screen.getByRole("button", { name: "More actions: Loose" });
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(7);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("quick timer pickers", () => {
  it("suggests projects in a menu panel and marks the picked task", async () => {
    setSelectHandler((sql) => {
      if (/FROM projects/i.test(sql)) return [{ id: 1, name: "Alpha", status: "active" }];
      if (/FROM tasks/i.test(sql)) return [{ id: 5, project_id: 1, title: "Draft", status: "todo" }];
      return [];
    });
    useAppStore.setState({ quickTimerOpen: true });
    wrap(<QuickTimerModal />);
    const field = screen.getByPlaceholderText(/select project/i);
    fireEvent.change(field, { target: { value: "alp" } });
    const option = await screen.findByRole("button", { name: "Alpha" });
    // Typing stays in the field while the suggestions show
    expect(document.activeElement).toBe(field);
    fireEvent.click(option);
    const task = await screen.findByRole("button", { name: "Draft" });
    expect(task).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(task);
    await waitFor(() => expect(task).toHaveAttribute("aria-pressed", "true"));
  });

  it("Esc closes the project suggestions first, the modal on a second press", async () => {
    setSelectHandler((sql) => (/FROM projects/i.test(sql) ? [{ id: 1, name: "Alpha", status: "active" }] : []));
    useAppStore.setState({ quickTimerOpen: true });
    wrap(<QuickTimerModal />);
    const field = screen.getByPlaceholderText(/select project/i);
    fireEvent.change(field, { target: { value: "alp" } });
    await screen.findByRole("button", { name: "Alpha" });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull());
    expect(useAppStore.getState().quickTimerOpen).toBe(true);
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(useAppStore.getState().quickTimerOpen).toBe(false));
  });
});
