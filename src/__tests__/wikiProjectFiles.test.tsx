import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WikiPage } from "../pages/WikiPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import { buildLinkIndex } from "../lib/wikiGraph";

// A project's Markdown files appear in the wiki, read from disk (never
// copied), open read-only in a tab, and show which articles link to them.

const article = {
  id: 1,
  folder_id: null,
  project_id: 4,
  title: "Structure",
  content: '<p>Tokens are in <a href="/wiki?file=4:DESIGN-SYSTEM.md">DESIGN-SYSTEM.md</a>.</p>',
  sort_order: 0,
  created_at: "",
  updated_at: "",
  tags_csv: null,
  project_name: "Studio Manager",
};

beforeEach(async () => {
  localStorage.clear();
  await getDb();
  useAppStore.setState({ language: "EN" });
  setSelectHandler((sql, params) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.startsWith("SELECT * FROM projects")) {
      return [{ id: 4, name: "Studio Manager", folder_path: "/Users/me/Documents/GitHub/StudioManager" }];
    }
    if (flat.includes("FROM wiki_articles a")) {
      if (flat.includes("WHERE a.id = $1")) return params[0] === 1 ? [article] : [];
      return [article];
    }
    return [];
  });
  setInvokeHandler((cmd, args) => {
    if (cmd === "list_project_docs") {
      return [
        { rel: "DESIGN-SYSTEM.md", title: "StudioManager Design System", modified: 0 },
        { rel: "docs/agent-access.md", title: "Agent access", modified: 0 },
      ];
    }
    if (cmd === "read_project_doc" && args.rel === "DESIGN-SYSTEM.md") {
      return { title: "StudioManager Design System", html: "<h1>StudioManager Design System</h1><p>Every new component…</p>" };
    }
    return null;
  });
});

afterEach(() => {
  setSelectHandler(null);
  setInvokeHandler(null);
  cleanup();
});

function renderWiki() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/wiki"]}>
        <WikiPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("project files in the wiki", () => {
  it("lists a project's files and opens one read-only, with the articles linking to it", async () => {
    renderWiki();
    const explorer = await screen.findByRole("complementary", { name: /wiki explorer/i });
    fireEvent.click(await within(explorer).findByRole("button", { name: /^studio manager\s*\d+$/i }));
    fireEvent.click(await within(explorer).findByRole("button", { name: /^files/i }));
    fireEvent.click(within(explorer).getByRole("button", { name: "DESIGN-SYSTEM.md" }));

    expect(await screen.findByRole("heading", { name: "StudioManager Design System" })).toBeInTheDocument();
    expect(screen.getByText(/read-only here/i)).toBeInTheDocument();
    const linkedFrom = screen.getByRole("region", { name: /linked from/i });
    expect(linkedFrom).toHaveTextContent("Linked from · 1");
    expect(linkedFrom).toHaveTextContent("Structure");
  });
});

describe("file backlinks in the link index", () => {
  it("records which articles link to a project file", () => {
    const index = buildLinkIndex([{ ...article }]);
    expect(index.fileBacklinks.get("file:4:DESIGN-SYSTEM.md")?.map((b) => b.sourceId)).toEqual([1]);
    expect([...index.fileOutgoing.get(1)!.keys()]).toEqual(["file:4:DESIGN-SYSTEM.md"]);
    expect(index.outgoing.size).toBe(0);
  });
});
