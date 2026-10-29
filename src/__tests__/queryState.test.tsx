import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FolderOpen } from "lucide-react";
import { QueryState, type QueryLike } from "../components/ui/QueryState";
import { EmptyState } from "../components/ui/EmptyState";

function q<T>(over: Partial<QueryLike<T>>): QueryLike<T> {
  return { data: undefined, isPending: true, isError: false, isFetching: false, refetch: vi.fn(), ...over };
}

function renderState(query: QueryLike<string[]>, extra: { noResults?: { onClear: () => void } } = {}) {
  return render(
    <QueryState
      query={query}
      skeleton={<div>skeleton</div>}
      errorMessage="Couldn't load projects"
      empty={<div>No projects yet</div>}
      noResults={extra.noResults}
    >
      {(rows) => <div>{rows.join(",")}</div>}
    </QueryState>
  );
}

describe("QueryState", () => {
  it("shows the skeleton while loading, never the empty text", () => {
    renderState(q({}));
    expect(screen.getByText("skeleton")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
  });

  it("a failed load shows the error and Retry (refetch), not the empty state", () => {
    const refetch = vi.fn();
    renderState(q({ isPending: false, isError: true, refetch }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load projects");
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the empty state for an empty array", () => {
    renderState(q({ data: [], isPending: false }));
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("no results: Clear filters calls onClear", () => {
    const onClear = vi.fn();
    renderState(q({ data: ["a"], isPending: false }), { noResults: { onClear } });
    expect(screen.getByText("No results")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders the content with data", () => {
    renderState(q({ data: ["a", "b"], isPending: false }));
    expect(screen.getByText("a,b")).toBeInTheDocument();
  });

  it("keeps cached data when a refetch fails", () => {
    renderState(q({ data: ["a"], isPending: false, isError: true }));
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EmptyState sizes", () => {
  it("lg (default): 32px icon, text-sm message, hint and action", () => {
    const { container } = render(
      <EmptyState icon={FolderOpen} message="No projects" hint="Create one" action={<button>New</button>} />
    );
    expect(container.querySelector("svg")).toHaveAttribute("width", "32");
    expect(screen.getByText("No projects")).toHaveClass("text-sm");
    expect(screen.getByText("Create one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("sm: 20px icon, text-xs message", () => {
    const { container } = render(<EmptyState size="sm" icon={FolderOpen} message="Nothing overdue" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
    expect(screen.getByText("Nothing overdue")).toHaveClass("text-xs");
  });

  it("keeps an icon passed as an element", () => {
    const { container } = render(<EmptyState icon={<FolderOpen size={14} />} message="x" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "14");
  });
});
