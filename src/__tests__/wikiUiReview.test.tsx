import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WikiPage } from "../pages/WikiPage";
import { WikiGraph } from "../components/wiki/WikiGraph";
import { WikiExplorer } from "../components/wiki/WikiExplorer";
import { buildLinkIndex } from "../lib/wikiGraph";
import { slashCommandQuery } from "../lib/wikiLinks";
import { projectColors } from "../components/wiki/wikiColors";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import type { WikiArticleWithTags } from "../types/wiki";

// Fixes from the wiki UI review (2026-10-28).

function art(id: number, title: string, project_id: number | null, content = ""): WikiArticleWithTags {
  return {
    id, title, content, project_id, folder_id: null, sort_order: 0, created_at: "", updated_at: "", tags: [],
    project_name: project_id === 1 ? "Alpha" : project_id === 2 ? "Beta" : undefined,
  };
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/wiki"]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  localStorage.clear();
  await getDb();
  useAppStore.setState({ language: "EN" });
  setSelectHandler(() => []);
});
afterEach(cleanup);

describe("slash command trigger", () => {
  it("opens at the start of a line or after a space", () => {
    expect(slashCommandQuery("/")).toBe("");
    expect(slashCommandQuery("/hea")).toBe("hea");
    expect(slashCommandQuery("Some text /li")).toBe("li");
    expect(slashCommandQuery("\0/h")).toBe("h");
  });

  it("stays shut inside a word, a fraction or a URL", () => {
    expect(slashCommandQuery("km/h")).toBeNull();
    expect(slashCommandQuery("and/or")).toBeNull();
    expect(slashCommandQuery("see https://example.com/page")).toBeNull();
    expect(slashCommandQuery("1/2")).toBeNull();
  });
});

describe("graph filters in Current article only", () => {
  const articles = [
    art(1, "Alpha home", 1, '<p><a href="/wiki?article=2">a</a> <a href="/wiki?article=3">b</a></p>'),
    art(2, "Alpha notes", 1),
    art(3, "Beta notes", 2),
  ];
  const renderGraph = () =>
    wrap(
      <WikiGraph
        articles={articles}
        folders={[]}
        index={buildLinkIndex(articles)}
        colors={projectColors(articles.map((a) => a.project_id))}
        activeRef={1}
        onOpen={() => {}}
      />
    );
  const dots = () => within(screen.getByRole("group")).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

  it("applies the project toggles and the text filter, keeping the article in focus", () => {
    renderGraph();
    fireEvent.click(screen.getByRole("switch", { name: /current article only/i }));
    expect(dots()).toHaveLength(3);
    const settings = screen.getByRole("region", { name: /graph settings/i });
    fireEvent.click(within(settings).getByRole("button", { name: /^beta/i }));
    expect(dots()).toEqual(["Alpha home, Alpha", "Alpha notes, Alpha"]);
    fireEvent.change(screen.getByRole("textbox", { name: /filter/i }), { target: { value: "zzz" } });
    expect(dots()).toEqual(["Alpha home, Alpha"]);
  });

  it("remembers its settings when the graph is opened again", () => {
    renderGraph();
    fireEvent.click(screen.getByRole("switch", { name: /show orphans/i }));
    cleanup();
    renderGraph();
    expect(screen.getByRole("switch", { name: /show orphans/i })).toHaveAttribute("aria-checked", "false");
  });

  it("offers to reset the filters when nothing is left", () => {
    renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: /filter/i }), { target: { value: "zzz" } });
    expect(screen.getByText(/no articles to show/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(dots()).toHaveLength(3);
  });

  it("is a single tab stop, arrow keys move between dots", () => {
    renderGraph();
    const focusable = within(screen.getByRole("group"))
      .getAllByRole("button")
      .filter((b) => b.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
    focusable[0].focus();
    fireEvent.keyDown(focusable[0], { key: "ArrowRight" });
    expect(document.activeElement).not.toBe(focusable[0]);
    expect(document.activeElement).toHaveAttribute("tabindex", "0");
  });
});

describe("explorer", () => {
  const articles = [art(1, "Alpha home", 1), art(2, "Loose", null)];
  const renderExplorer = () =>
    wrap(
      <WikiExplorer
        articles={articles}
        docs={[]}
        activeRef={null}
        colors={projectColors([1])}
        onOpen={() => {}}
        onNewArticle={() => {}}
        onOpenGraph={() => {}}
        onDeleteArticle={() => {}}
      />
    );

  it("says so when the search matches nothing", () => {
    renderExplorer();
    fireEvent.change(screen.getByPlaceholderText(/search articles/i), { target: { value: "zzz" } });
    expect(screen.getByText(/nothing matches this search/i)).toBeInTheDocument();
  });

  it("counts articles and files in its footer", () => {
    renderExplorer();
    expect(screen.getByText("2 articles · 0 files")).toBeInTheDocument();
  });

  it("moves through the tree with the arrow keys", () => {
    renderExplorer();
    const tree = screen.getByRole("tree");
    const [first, second] = within(tree).getAllByRole("treeitem");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(second).toHaveAttribute("aria-expanded", "true");
  });
});

describe("empty wiki", () => {
  it("offers a New article button once articles have loaded", async () => {
    wrap(<WikiPage />);
    // Not before they have loaded: no first-run message flashing by.
    expect(screen.queryByText(/keep notes, processes/i)).toBeNull();
    expect(await screen.findByText(/keep notes, processes/i)).toBeInTheDocument();
    // The explorer's icon button, and the empty state's own.
    expect(screen.getAllByRole("button", { name: /^new article$/i })).toHaveLength(2);
  });
});
