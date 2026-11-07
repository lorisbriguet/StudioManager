import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ArticleEditor } from "../pages/WikiPage";
import { useAppStore } from "../stores/app-store";
import { useUndoStore } from "../stores/undo-store";
import { getDb } from "../db";
import { notify } from "../lib/notify";
import { uiLabels } from "../i18n/ui";
import { setSelectHandler, executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";

// Deleting from the article's "..." menu closes the article (onBack), which
// unmounts the editor. The Undo toast must still show: the editor goes back
// only once the delete is done.

vi.mock("@tiptap/react", () => ({
  useEditor: () => ({ getHTML: () => "", commands: { focus: () => {} }, setEditable: () => {} }),
  EditorContent: () => null,
}));

vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<object>()),
  notify: { success: vi.fn(), undo: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const article = {
  id: 1, folder_id: null, project_id: null, title: "Article One", content: "<p>Links to [[Two]]</p>",
  sort_order: 0, created_at: "", updated_at: "", project_name: null,
};

function Harness({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? <ArticleEditor articleId={1} onBack={() => { setOpen(false); onBack(); }} /> : <p>closed</p>;
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  clearExecutedStatements();
  vi.mocked(notify.undo).mockClear();
  vi.mocked(notify.success).mockClear();
  setSelectHandler((sql) => (sql.includes("wiki_articles") ? [article] : []));
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("wiki article delete from the more menu", () => {
  it("deletes, shows the Undo toast, then closes the article", async () => {
    const onBack = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness onBack={onBack} />
      </QueryClientProvider>
    );
    await screen.findByDisplayValue("Article One");

    fireEvent.click(screen.getByRole("button", { name: uiLabels.EN.more_actions }));
    fireEvent.click(await screen.findByText(uiLabels.EN.delete));

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(executedStatements.some((s) => s.sql.includes("DELETE FROM wiki_articles"))).toBe(true);
    expect(notify.undo).toHaveBeenCalledWith(uiLabels.EN.article_deleted, expect.any(Function));
    expect(notify.success).not.toHaveBeenCalled();
    expect(screen.getByText("closed")).toBeTruthy();
  });
});
