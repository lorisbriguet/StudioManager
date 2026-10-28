import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { WikiGraph } from "../components/wiki/WikiGraph";
import { buildLinkIndex } from "../lib/wikiGraph";
import { projectColors } from "../components/wiki/wikiColors";
import { useAppStore } from "../stores/app-store";
import type { WikiArticleWithTags } from "../types/wiki";

// The graph tab's settings: project filters, text filter, and Local.

function art(id: number, title: string, project_id: number | null, content = ""): WikiArticleWithTags {
  return {
    id, title, content, project_id, folder_id: null, sort_order: 0, created_at: "", updated_at: "", tags: [],
    project_name: project_id === 1 ? "Alpha" : project_id === 2 ? "Beta" : undefined,
  };
}

const articles = [
  art(1, "Alpha home", 1, '<p><a href="/wiki?article=2">a2</a></p>'),
  art(2, "Alpha notes", 1),
  art(3, "Beta home", 2, '<p><a href="/wiki?article=4">b4</a></p>'),
  art(4, "Beta notes", 2),
  art(5, "Loose", null),
];

const docs = [
  { key: "file:1:README.md", projectId: 1, projectName: "Alpha", rel: "README.md", title: "Read me", links: [] },
];

function renderGraph(activeRef: number | null = null, withDocs = false) {
  render(
    <WikiGraph
      articles={articles}
      docs={withDocs ? docs : []}
      folders={[]}
      index={buildLinkIndex(articles)}
      colors={projectColors(articles.map((a) => a.project_id))}
      activeRef={activeRef}
      onOpen={() => {}}
    />
  );
}

const dots = () => within(screen.getByRole("group")).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  // Graph settings are remembered: start each test from the defaults.
  localStorage.clear();
  useAppStore.setState({ language: "EN" });
});
afterEach(cleanup);

describe("WikiGraph settings", () => {
  it("hides a project's articles when it is unticked", () => {
    renderGraph();
    expect(dots()).toHaveLength(5);
    const settings = screen.getByRole("region", { name: /graph settings/i });
    fireEvent.click(within(settings).getByRole("button", { name: /^beta/i }));
    expect(dots()).toHaveLength(3);
    expect(dots().join()).not.toMatch(/Beta/);
  });

  it("filters by title", () => {
    renderGraph();
    fireEvent.change(screen.getByRole("textbox", { name: /filter/i }), { target: { value: "notes" } });
    expect(dots()).toEqual(["Alpha notes, Alpha", "Beta notes, Beta"]);
  });

  it("hides orphans when asked", () => {
    renderGraph();
    fireEvent.click(screen.getByRole("switch", { name: /show orphans/i }));
    expect(dots()).toHaveLength(4);
  });

  it("Current article only shows that article and its links", () => {
    renderGraph(3);
    const local = screen.getByRole("switch", { name: /current article only/i });
    fireEvent.click(local);
    expect(dots()).toEqual(["Beta home, Beta", "Beta notes, Beta"]);
    fireEvent.click(local);
    expect(dots()).toHaveLength(5);
  });

  it("draws project files and hides them with Show project files", () => {
    renderGraph(null, true);
    expect(dots()).toContain("README.md, Alpha");
    expect(dots()).toHaveLength(6);
    fireEvent.click(screen.getByRole("switch", { name: /show project files/i }));
    expect(dots()).toHaveLength(5);
  });

  it("disables Current article only when no article has been open", () => {
    renderGraph(null);
    expect(screen.getByRole("switch", { name: /current article only/i })).toBeDisabled();
  });
});
