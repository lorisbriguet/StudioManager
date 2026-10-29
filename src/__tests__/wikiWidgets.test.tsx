import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WikiOverviewWidget, WikiRecentWidget } from "../components/dashboard/WikiWidgets";
import { WIDGET_CATALOG } from "../stores/dashboard-store";

let articles: unknown[] | undefined;
vi.mock("../db/hooks/useWiki", () => ({
  useWikiArticles: () => ({ data: articles }),
}));

const day = 86_400_000;
const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const article = (id: number, title: string, msAgo: number, project_id: number | null = null) => ({
  id, title, folder_id: null, project_id, content: "", sort_order: 0, created_at: at(30 * day), updated_at: at(msAgo), tags: [],
  project_name: project_id ? `Project ${project_id}` : undefined,
});

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("wiki dashboard widgets", () => {
  beforeEach(() => {
    articles = [article(1, "Old", 20 * day), article(2, "Newest", 1000, 4), article(3, "Middle", 2 * day, 4)];
  });

  it("recent lists articles newest first, each linking to its article", () => {
    inRouter(<WikiRecentWidget />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Newest"),
      expect.stringContaining("Middle"),
      expect.stringContaining("Old"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/wiki?article=2");
    expect(screen.getAllByText(/Project 4/)).toHaveLength(2);
  });

  it("recent shows an empty state without articles", () => {
    articles = [];
    inRouter(<WikiRecentWidget />);
    expect(screen.getByText("No wiki articles yet")).toBeInTheDocument();
  });

  it("overview counts articles, this week's edits and projects", () => {
    inRouter(<WikiOverviewWidget />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2 edited this week · 1 projects with articles")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/wiki");
  });

  it("both widgets are in the catalogue", () => {
    const types = WIDGET_CATALOG.map((w) => w.type);
    expect(types).toContain("wiki-recent");
    expect(types).toContain("wiki-overview");
  });
});
