import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PageHeader } from "../components/ui/PageHeader";
import { PeekHeader } from "../components/ui/PeekHeader";
import { SidebarTitle } from "../components/ui/SidebarTitle";
import { PanelTitle } from "../components/ui/PanelTitle";
import { HEADING_1, HEADING_2 } from "../components/ui/tokens";
import { useAppStore } from "../stores/app-store";

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
});
afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the title as the page h1 at level 1", () => {
    render(<PageHeader title="Clients" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Clients" });
    expect(h1.className).toContain(HEADING_1);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("shows one back button that calls onBack", () => {
    const onBack = vi.fn();
    render(<PageHeader title="Acme" back={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("puts meta under the title and actions on the right", () => {
    render(
      <PageHeader title="Notifications" meta="3 unread" actions={<button type="button">Mark all read</button>} />
    );
    expect(screen.getByText("3 unread")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Notifications");
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeInTheDocument();
  });

  it("still takes actions as children", () => {
    render(
      <PageHeader title="Expenses">
        <button type="button">New expense</button>
      </PageHeader>
    );
    expect(screen.getByRole("button", { name: "New expense" })).toBeInTheDocument();
  });

  it("renders leading content before the title", () => {
    render(<PageHeader title="October 2026" leading={<button type="button">Today</button>} />);
    const today = screen.getByRole("button", { name: "Today" });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(today.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("compact: keeps the h1 at level 2 in a bordered bar", () => {
    const { container } = render(<PageHeader compact title="F-2026-001 — Acme" back={() => {}} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain(HEADING_2);
    expect(h1.className).not.toContain("text-xl");
    expect((container.firstChild as HTMLElement).className).toContain("border-b");
  });

  it('as="h2": a level-2 h2 for peek panels', () => {
    render(<PageHeader as="h2" title="Website" />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Website" }).className).toContain(HEADING_2);
  });
});

describe("PeekHeader", () => {
  it("closes on the left and opens the full page on the right", () => {
    const onClose = vi.fn();
    const onOpenFull = vi.fn();
    render(<PeekHeader onClose={onClose} onOpenFull={onOpenFull} />);
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveAccessibleName("Close");
    expect(second).toHaveAccessibleName("Open full page");
    fireEvent.click(first);
    fireEvent.click(second);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarTitle", () => {
  it("is the page h1 at level 1", () => {
    render(<SidebarTitle>Settings</SidebarTitle>);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" }).className).toContain(HEADING_1);
  });
});

describe("PanelTitle", () => {
  it("is level 2: 14px semibold", () => {
    render(<PanelTitle title="Line items" />);
    expect(screen.getByRole("heading", { level: 2 }).className).toContain(HEADING_2);
  });

  it("shows a muted count after the title", () => {
    render(<PanelTitle title="Projects" count={3} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Projects3");
    const count = screen.getByText("3");
    expect(count.className).toContain("text-muted");
    expect(heading).toContainElement(count);
  });

  it("shows a zero count but not a missing one", () => {
    const { rerender } = render(<PanelTitle title="Invoices" count={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    rerender(<PanelTitle title="Invoices" />);
    expect(screen.getByRole("heading").textContent).toBe("Invoices");
  });
});
