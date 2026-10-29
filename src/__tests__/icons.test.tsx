import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { isValidElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { Download } from "lucide-react";
import { ICONS, ICON_SIZE, ICON_STROKE, isIconComponent, renderIcon } from "../components/ui/icons";
import { Button } from "../components/ui/Button";
import { NavItem, navIcon } from "../components/ui/NavItem";
import { ContextMenu } from "../components/ui/ContextMenu";
import { Dropdown } from "../components/ui/Dropdown";
import { MenuItem } from "../components/ui/MenuItem";
import { TabItem } from "../components/ui/TabItem";
import { Card } from "../components/ui/Card";
import { IconButton } from "../components/ui/IconButton";

afterEach(cleanup);

const svgIn = (el: Element) => el.querySelector("svg")!;

describe("ICONS", () => {
  it("maps every concept to a lucide component, not an element", () => {
    for (const [name, icon] of Object.entries(ICONS)) {
      expect(isIconComponent(icon), name).toBe(true);
      expect(isValidElement(icon), name).toBe(false);
    }
  });

  it("uses the approved icons for the concepts that had double meanings", () => {
    expect(ICONS.invoice.displayName).toBe("Receipt");
    expect(ICONS.expense.displayName).toBe("CreditCard");
    expect(ICONS.more.displayName).toBe("Ellipsis");
    expect(ICONS.settings.displayName).toBe("Settings2");
    expect(ICONS.duplicate).not.toBe(ICONS.copy);
    expect(ICONS.newTab).not.toBe(ICONS.goToLinked);
    expect(ICONS.markUnpaid).not.toBe(ICONS.danger);
  });

  it("has the size and stroke scales", () => {
    expect(ICON_SIZE).toEqual({ pill: 10, control: 12, menu: 14, callout: 16, nav: 18, emptySm: 20, empty: 32 });
    expect(ICON_STROKE).toEqual({ default: 2, nav: 1.5, check: 3 });
  });

  it("renderIcon sizes a component and keeps an element as is", () => {
    const { container, rerender } = render(<>{renderIcon(Download, 14)}</>);
    expect(svgIn(container)).toHaveAttribute("width", "14");
    rerender(<>{renderIcon(<span data-testid="own">x</span>, 14)}</>);
    expect(screen.getByTestId("own")).toBeInTheDocument();
    rerender(<>{renderIcon(null, 14)}</>);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("components size their own icons", () => {
  it("Button draws a component icon at 12px", () => {
    render(<Button icon={ICONS.download}>Export</Button>);
    expect(svgIn(screen.getByRole("button", { name: "Export" }))).toHaveAttribute("width", String(ICON_SIZE.control));
  });

  it("NavItem draws a component icon at 14px; navIcon gives the sidebar's 18px / 1.5 stroke", () => {
    render(<NavItem active={false} icon={ICONS.settings}>General</NavItem>);
    expect(svgIn(screen.getByRole("button", { name: "General" }))).toHaveAttribute("width", "14");
    const { container } = render(<>{navIcon(ICONS.dashboard)}</>);
    expect(svgIn(container)).toHaveAttribute("width", "18");
    expect(svgIn(container)).toHaveAttribute("stroke-width", "1.5");
  });

  it("ContextMenu and Dropdown items draw a component icon at 14px", () => {
    render(<ContextMenu x={0} y={0} onClose={() => {}} items={[{ label: "Delete", icon: ICONS.delete, onClick: () => {} }]} />);
    expect(svgIn(screen.getByRole("menuitem", { name: "Delete" }))).toHaveAttribute("width", "14");
    cleanup();
    render(<Dropdown trigger={<button type="button">Open</button>} items={[{ label: "Copy", icon: ICONS.copy, onSelect: () => {} }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(svgIn(screen.getByRole("menuitem", { name: "Copy" }))).toHaveAttribute("width", "14");
  });

  it("MenuItem, TabItem and Card.Header draw a component icon at 14px", () => {
    render(
      <>
        <MenuItem icon={ICONS.pin}>Pin</MenuItem>
        <TabItem label="Wiki" active={false} onActivate={() => {}} icon={ICONS.wikiArticle} />
        <Card>
          <Card.Header title="Files" icon={ICONS.file} />
        </Card>
      </>
    );
    expect(svgIn(screen.getByRole("button", { name: "Pin" }))).toHaveAttribute("width", "14");
    expect(svgIn(screen.getByRole("button", { name: "Wiki" }))).toHaveAttribute("width", "14");
    expect(svgIn(screen.getByRole("heading", { name: "Files" }).parentElement!.parentElement!)).toHaveAttribute("width", "14");
  });
});

describe("IconButton as a link", () => {
  it("renders a router Link with `to`, labelled, with the sm icon", () => {
    render(
      <MemoryRouter>
        <IconButton to="/invoices/7" icon={ICONS.preview} label="Preview" />
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "Preview" });
    expect(link).toHaveAttribute("href", "/invoices/7");
    expect(link).not.toHaveAttribute("type");
    expect(svgIn(link)).toHaveAttribute("width", "14");
  });

  it("renders a plain <a> with `href`", () => {
    render(<IconButton href="https://example.com" target="_blank" icon={ICONS.openExternal} label="Open" size="xs" />);
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(svgIn(link)).toHaveAttribute("width", "12");
  });
});
