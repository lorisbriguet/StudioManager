import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Card, cardClass } from "../components/ui/Card";
import { StatTile } from "../components/ui/StatTile";

afterEach(cleanup);

describe("Card", () => {
  it("pads 16px by default, 12px with sm, none with none", () => {
    const { rerender } = render(<Card data-testid="c">x</Card>);
    expect(screen.getByTestId("c").className).toContain("p-4");
    expect(screen.getByTestId("c").className).toContain("rounded-xl");
    rerender(<Card data-testid="c" padding="sm">x</Card>);
    expect(screen.getByTestId("c").className).toContain("p-3");
    rerender(<Card data-testid="c" padding="none">x</Card>);
    expect(screen.getByTestId("c").className).not.toMatch(/\bp-\d/);
    expect(screen.getByTestId("c").className).not.toContain("p-5");
  });

  it("tones: surface fill, inset border, dashed transparent", () => {
    expect(cardClass()).toContain("bg-[var(--color-surface)]");
    expect(cardClass()).not.toContain("border");
    expect(cardClass({ tone: "inset" })).toContain("border-[var(--color-border-divider)]");
    const dashed = cardClass({ tone: "dashed" });
    expect(dashed).toContain("border-dashed");
    expect(dashed).toContain("border-[var(--color-input-border)]");
    expect(dashed).not.toContain("bg-[var(--color-surface)]");
  });

  it("renders the requested element", () => {
    render(<Card as="section" aria-label="Block">x</Card>);
    expect(screen.getByRole("region", { name: "Block" }).tagName).toBe("SECTION");
  });

  it("is a plain block when not interactive", () => {
    render(<Card data-testid="c" onClick={() => {}}>x</Card>);
    const el = screen.getByTestId("c");
    expect(el).not.toHaveAttribute("role");
    expect(el).not.toHaveAttribute("tabindex");
  });

  it("interactive: a focusable button that Enter and Space activate", () => {
    const onClick = vi.fn();
    render(<Card interactive onClick={onClick}>Project</Card>);
    const card = screen.getByRole("button", { name: "Project" });
    expect(card).toHaveAttribute("tabindex", "0");
    expect(card.className).toContain("cursor-pointer");
    expect(card.className).toContain("hover:bg-[var(--color-hover-row)]");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("interactive: keys typed in a child control don't activate the card", () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        <input aria-label="inner" />
      </Card>
    );
    fireEvent.keyDown(screen.getByLabelText("inner"), { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("interactive: the activation key does not reach window listeners", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Card interactive onClick={() => {}}>Project</Card>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).toHaveBeenCalledTimes(1);
    expect(onWindowKey.mock.calls[0][0].key).toBe("ArrowDown");
  });

  it("as=button is a native button, no role or tabindex added", () => {
    const onClick = vi.fn();
    render(<Card as="button" interactive tone="inset" onClick={onClick}>Open</Card>);
    const btn = screen.getByRole("button", { name: "Open" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).not.toHaveAttribute("tabindex");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("selected: the accent outline", () => {
    render(<Card data-testid="c" interactive selected onClick={() => {}}>x</Card>);
    expect(screen.getByTestId("c").className).toContain("outline-accent");
  });
});

describe("Card.Header", () => {
  it("renders a level-2 title (h2), 12px below", () => {
    const { container } = render(<Card.Header title="Profit and loss" />);
    const h = screen.getByRole("heading", { level: 2, name: "Profit and loss" });
    expect(h.className).toContain("text-sm");
    expect(container.firstElementChild!.className).toContain("mb-3");
    expect(container.innerHTML).not.toContain("text-base");
  });

  it("count sits after the title, muted", () => {
    render(<Card.Header title="Contacts" count={3} />);
    const h = screen.getByRole("heading");
    expect(h).toHaveTextContent("Contacts3");
    expect(screen.getByText("3").className).toContain("text-muted");
  });

  it("variant=label uses the SectionLabel style", () => {
    render(<Card.Header title="Details" variant="label" />);
    expect(screen.getByRole("heading").className).toContain("uppercase");
  });

  it("action slot takes several controls; onClose adds the close button", () => {
    const onClose = vi.fn();
    render(
      <Card.Header
        title="Recurring"
        action={
          <>
            <button>Generate</button>
            <button>Refresh</button>
          </>
        }
        onClose={onClose}
      />
    );
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("divider draws a rule; subtitle a muted line; icon leads", () => {
    const { container } = render(
      <Card.Header title="Calendar" divider subtitle="Pick a calendar" icon={<span data-testid="icon" />} />
    );
    expect(container.firstElementChild!.className).toContain("border-b");
    expect(screen.getByText("Pick a calendar").className).toContain("text-muted");
    const icon = screen.getByTestId("icon");
    const heading = screen.getByRole("heading");
    expect(icon.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("className replaces the default margin", () => {
    const { container } = render(<Card.Header title="x" className="px-3 py-2" />);
    expect(container.firstElementChild!.className).not.toContain("mb-3");
    expect(container.firstElementChild!.className).toContain("px-3");
  });
});

describe("StatTile", () => {
  it("label, 20px value and caption", () => {
    render(<StatTile label="Margin" value="42%" caption="of revenue" tone="success" />);
    expect(screen.getByText("Margin")).toBeInTheDocument();
    const v = screen.getByText("42%");
    expect(v.className).toContain("text-xl");
    expect(v.className).toContain("tabular-nums");
    expect(v.className).toContain("text-success");
    expect(screen.getByText("of revenue").className).toContain("text-muted");
  });
});
