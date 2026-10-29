import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProjectBlockLayout } from "../components/ProjectBlockLayout";
import { DocView } from "../components/wiki/DocView";
import { useAppStore } from "../stores/app-store";
import type { Project } from "../types/project";
import type { ProjectDoc } from "../db/hooks/useProjectDocs";

// Heading levels follow the page: a project's blocks are h2 under the
// project page's h1, and h3 under the h2 title of a peek panel. A wiki file
// view always has an h1.

vi.mock("../db/hooks/useProjects", () => ({
  useUpdateProject: () => ({ mutate: vi.fn() }),
}));

let docContent: { title: string; html: string } | undefined;
vi.mock("../db/hooks/useProjectDocs", () => ({
  useProjectDoc: () => ({ data: docContent, isLoading: false, isError: false }),
}));

const project = { id: 7, name: "Site", layout_config: JSON.stringify([{ type: "tasks" }, { type: "notes" }]) } as Project;

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
});

afterEach(() => {
  cleanup();
});

describe("ProjectBlockLayout heading level", () => {
  it("renders the block titles as h2 on the full page", () => {
    render(<ProjectBlockLayout project={project} projectId={7} renderBlock={() => null} />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("renders them as h3 in a peek panel", () => {
    render(<ProjectBlockLayout project={project} projectId={7} renderBlock={() => null} headingAs="h3" />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  });
});

describe("DocView title", () => {
  const doc: ProjectDoc = {
    key: "file:7:docs/usage.md",
    projectId: 7,
    projectName: "Site",
    folder: "/tmp/site",
    rel: "docs/usage.md",
    title: "Usage",
    modified: 0,
    links: [],
  };
  const nav = { canBack: false, canForward: false, onBack: () => {}, onForward: () => {} };

  it("adds an h1 from the file name when the Markdown has no title of its own", () => {
    docContent = { title: "usage", html: "<p>Hello</p>" };
    render(<DocView doc={doc} nav={nav} onOpenRef={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "usage.md" })).toBeInTheDocument();
  });

  it("keeps the file's own h1 and adds none", () => {
    docContent = { title: "Usage", html: "<h1>Usage guide</h1><p>Hello</p>" };
    render(<DocView doc={doc} nav={nav} onOpenRef={() => {}} />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Usage guide");
  });
});
