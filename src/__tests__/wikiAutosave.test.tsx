import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ArticleEditor } from "../pages/WikiPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// A debounced save scheduled while article 1 is open must never land on a
// DIFFERENT article after the editor moves on inside the 2s window — that
// would either corrupt the newly opened article or resurrect stale content.
// The component doesn't remount between articles (no `key`), so a debounce
// timer scheduled for one article is still alive when another opens.

interface FakeProseMirrorEditor {
  getHTML: () => string;
  state: {
    selection: { from: number };
    doc: {
      resolve: (pos: number) => { start: () => number };
      textBetween: (from: number, to: number, sep: string) => string;
    };
  };
}
type FakeOnUpdate = (arg: { editor: FakeProseMirrorEditor }) => void;

let latestOnUpdate: FakeOnUpdate | null = null;

vi.mock("@tiptap/react", () => ({
  useEditor: (config: { onUpdate?: FakeOnUpdate }) => {
    latestOnUpdate = config.onUpdate ?? null;
    return {
      getHTML: () => "",
      commands: { focus: () => {} },
    };
  },
  EditorContent: () => null,
}));

function typedContent(html: string): FakeProseMirrorEditor {
  return {
    getHTML: () => html,
    state: {
      selection: { from: 0 },
      doc: {
        resolve: () => ({ start: () => 0 }),
        textBetween: () => "", // no "/" in view -> no slash-menu branch
      },
    },
  };
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
const article2 = {
  id: 2,
  folder_id: null,
  project_id: null,
  title: "Article Two",
  content: "",
  sort_order: 0,
  created_at: "",
  updated_at: "",
  project_name: null,
};

function Harness({ initialId }: { initialId: number }) {
  const [id, setId] = useState(initialId);
  return (
    <div>
      <button onClick={() => setId(2)}>switch-to-2</button>
      <ArticleEditor articleId={id} onBack={() => {}} />
    </div>
  );
}

function renderHarness() {
  setSelectHandler((sql, params) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM wiki_articles a") && flat.includes("WHERE a.id = $1")) {
      if (params[0] === 1) return [article1];
      if (params[0] === 2) return [article2];
      return [];
    }
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness initialId={1} />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
  latestOnUpdate = null;
});

afterEach(() => {
  vi.useRealTimers();
  setSelectHandler(null);
  cleanup();
});

describe("wiki article autosave", () => {
  it("does not write anywhere when the article changes before the 2s debounce fires", async () => {
    renderHarness();
    await screen.findByDisplayValue("Article One");
    expect(latestOnUpdate).not.toBeNull();

    vi.useFakeTimers();
    act(() => {
      latestOnUpdate!({ editor: typedContent("<p>typed in article 1</p>") });
    });

    fireEvent.click(screen.getByText("switch-to-2"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(
      executedStatements.filter((s) => s.sql.includes("UPDATE wiki_articles")).length
    ).toBe(0);
  });

  it("still saves after the debounce delay when the article stays open", async () => {
    renderHarness();
    await screen.findByDisplayValue("Article One");
    expect(latestOnUpdate).not.toBeNull();

    vi.useFakeTimers();
    act(() => {
      latestOnUpdate!({ editor: typedContent("<p>typed in article 1</p>") });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const updates = executedStatements.filter((s) => s.sql.includes("UPDATE wiki_articles"));
    expect(updates.length).toBe(1);
    expect(updates[0].sql).toContain("content");
  });
});
