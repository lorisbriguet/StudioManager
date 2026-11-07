import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArticleEditor } from "../pages/WikiPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";
import { emit } from "../__mocks__/tauri-event";
import { invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { flushAll, installQuitFlush } from "../lib/quitFlush";
import { buildLinkIndex } from "../lib/wikiGraph";

// Wiki saves: a title being typed survives the body autosave (one save path
// for both), a pending save is written before the app quits or the window is
// hidden, and a text save patches the caches instead of reading the whole
// wiki again.

type FakeOnUpdate = (arg: { editor: ReturnType<typeof typed>; transaction: { docChanged: boolean } }) => void;
let latestOnUpdate: FakeOnUpdate | null = null;
let editorHtml = "";

vi.mock("@tiptap/react", () => ({
  useEditor: (config: { onUpdate?: FakeOnUpdate }) => {
    latestOnUpdate = config.onUpdate ?? null;
    return {
      getHTML: () => editorHtml,
      commands: { focus: () => {} },
      setEditable: () => {},
    };
  },
  EditorContent: () => null,
}));

function typed(html: string) {
  editorHtml = html;
  return {
    getHTML: () => html,
    state: {
      selection: { from: 0 },
      doc: { resolve: () => ({ start: () => 0 }), textBetween: () => "" },
    },
  };
}

function type(html: string) {
  act(() => {
    latestOnUpdate!({ editor: typed(html), transaction: { docChanged: true } });
  });
}

const article1 = {
  id: 1,
  folder_id: null,
  project_id: null,
  title: "Article One",
  content: "",
  sort_order: 0,
  created_at: "",
  updated_at: "",
  project_name: null,
};

let listReads = 0;

function renderEditor() {
  listReads = 0;
  setSelectHandler((sql, params) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM wiki_articles a") && flat.includes("WHERE a.id = $1")) {
      // The row as saved so far: a refetch after a save returns new content.
      const row = { ...article1 };
      for (const u of updates()) {
        const cols = [...u.sql.matchAll(/(\w+) = \$(\d+)/g)];
        for (const [, col, n] of cols) (row as Record<string, unknown>)[col] = u.params[Number(n) - 1];
      }
      return params[0] === 1 ? [row] : [];
    }
    if (flat.includes("FROM wiki_articles a") && flat.includes("GROUP BY a.id")) {
      listReads++;
      return [{ ...article1, tags_csv: null }];
    }
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ArticleEditor articleId={1} onBack={() => {}} />
    </QueryClientProvider>
  );
}

const updates = () => executedStatements.filter((s) => s.sql.includes("UPDATE wiki_articles"));

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
  clearInvokedCommands();
  latestOnUpdate = null;
  editorHtml = "";
});

afterEach(() => {
  vi.useRealTimers();
  setSelectHandler(null);
  cleanup();
});

describe("wiki title and body saves (2-X1)", () => {
  it("keeps a title being typed when the body autosave lands, and saves it", async () => {
    renderEditor();
    const input = await screen.findByDisplayValue("Article One");

    vi.useFakeTimers();
    type("<p>body</p>");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "My new title" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(screen.getByDisplayValue("My new title")).toBeTruthy();
    const saved = updates();
    expect(saved.length).toBe(1);
    expect(saved[0].sql).toContain("title");
    expect(saved[0].params).toContain("My new title");
    expect(saved[0].params).toContain("<p>body</p>");
  });
});

describe("wiki save before quit (2-X2)", () => {
  it("writes the pending text at once when the app is about to quit", async () => {
    const uninstall = installQuitFlush();
    renderEditor();
    await screen.findByDisplayValue("Article One");

    vi.useFakeTimers();
    type("<p>last sentence</p>");
    expect(updates().length).toBe(0);

    await act(async () => {
      await emit("app-will-quit");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updates().length).toBe(1);
    expect(updates()[0].params).toContain("<p>last sentence</p>");
    expect(invokedCommands.some((c) => c.cmd === "quit_ready")).toBe(true);

    // The timer was cleared: nothing is written a second time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(updates().length).toBe(1);
    uninstall();
  });

  it("writes the pending text when the window is hidden", async () => {
    const uninstall = installQuitFlush();
    renderEditor();
    await screen.findByDisplayValue("Article One");

    vi.useFakeTimers();
    type("<p>before hiding</p>");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility.mockRestore();

    expect(updates().length).toBe(1);
    expect(updates()[0].params).toContain("<p>before hiding</p>");
    uninstall();
  });

  it("has nothing to write when nothing is pending", async () => {
    renderEditor();
    await screen.findByDisplayValue("Article One");
    await act(async () => {
      await flushAll();
    });
    expect(updates().length).toBe(0);
  });
});

describe("wiki autosave cost (2-P1)", () => {
  it("does not read the article list again after a text save", async () => {
    renderEditor();
    await screen.findByDisplayValue("Article One");
    await act(async () => {
      await vi.waitFor(() => expect(listReads).toBeGreaterThan(0));
    });
    const before = listReads;

    vi.useFakeTimers();
    type("<p>more text</p>");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 50));

    expect(updates().length).toBe(1);
    expect(listReads).toBe(before);
  });

  it("re-parses only the article whose text changed", () => {
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    const a = { id: 101, title: "A", content: '<p><a href="/wiki?article=102">B</a></p>', project_id: null, folder_id: null };
    const b = { id: 102, title: "B", content: '<p><a href="/wiki?article=101">A</a></p>', project_id: null, folder_id: null };
    buildLinkIndex([a, b]);
    parse.mockClear();

    const edited = { ...a, content: '<p>Now <a href="/wiki?article=102">B</a></p>' };
    const index = buildLinkIndex([edited, b]);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(index.backlinks.get(102)?.[0].snippets[0].before).toContain("Now");
    expect(index.backlinks.get(101)?.[0].sourceId).toBe(102);
    parse.mockRestore();
  });
});
