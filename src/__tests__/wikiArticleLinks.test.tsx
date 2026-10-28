import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WikiPage } from "../pages/WikiPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// Links between wiki articles: `/wiki?article=<id>` in the address opens that
// article, and Cmd/Ctrl-clicking such a link inside an article follows it.

function makeArticle(id: number, title: string, content = "") {
  return {
    id,
    folder_id: null,
    project_id: null,
    title,
    content,
    sort_order: id,
    created_at: "",
    updated_at: "",
    tags_csv: null,
    project_name: null,
  };
}

const articles = [
  makeArticle(1, "Article One", '<p>See <a href="/wiki?article=2">Article Two</a></p>'),
  makeArticle(2, "Article Two", "<p>Second</p>"),
];

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <WikiPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  localStorage.clear();
  await getDb();
  useAppStore.setState({ language: "EN" });
  setSelectHandler((sql, params) => {
    const flat = sql.replace(/\s+/g, " ");
    if (!flat.includes("FROM wiki_articles a")) return [];
    if (flat.includes("WHERE a.id = $1")) {
      return articles.filter((a) => a.id === params[0]);
    }
    return articles;
  });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("wiki article links", () => {
  it("opens the article named in the address", async () => {
    renderAt("/wiki?article=2");
    expect(await screen.findByDisplayValue("Article Two")).toBeInTheDocument();
  });

  it("stays on the list when the address names an unknown article", async () => {
    renderAt("/wiki?article=99");
    expect(await screen.findByRole("button", { name: /^new article$/i })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/Article/)).not.toBeInTheDocument();
  });

  it("follows an internal link on Cmd-click while editing", async () => {
    localStorage.setItem("wikiMode", JSON.stringify("editing"));
    renderAt("/wiki?article=1");
    await screen.findByDisplayValue("Article One");
    const link = await screen.findByText("Article Two", { selector: "a" });

    fireEvent.click(link);
    expect(screen.getByDisplayValue("Article One")).toBeInTheDocument();

    fireEvent.click(link, { metaKey: true });
    expect(await screen.findByDisplayValue("Article Two")).toBeInTheDocument();
  });

  it("follows a link on a plain click while reading, and Back returns", async () => {
    renderAt("/wiki?article=1");
    await screen.findByDisplayValue("Article One");
    fireEvent.click(await screen.findByText("Article Two", { selector: "a" }));
    expect(await screen.findByDisplayValue("Article Two")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByDisplayValue("Article One")).toBeInTheDocument();
  });

  it("opens a link in a new tab on Cmd-click while reading", async () => {
    renderAt("/wiki?article=1");
    await screen.findByDisplayValue("Article One");
    fireEvent.click(await screen.findByText("Article Two", { selector: "a" }), { metaKey: true });
    expect(await screen.findByDisplayValue("Article Two")).toBeInTheDocument();
    const bar = screen.getByRole("tablist", { name: /^open articles$/i });
    expect(within(bar).getAllByRole("tab")).toHaveLength(2);
  });

  it("shows backlinks for the open article", async () => {
    renderAt("/wiki?article=2");
    await screen.findByDisplayValue("Article Two");
    const panel = screen.getByRole("region", { name: /^backlinks$/i });
    expect(panel).toHaveTextContent("Backlinks · 1");
    expect(panel).toHaveTextContent("Article One");
  });
});
