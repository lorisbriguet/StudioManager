import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NavItem, navItemClass } from "../components/ui/NavItem";

afterEach(cleanup);

describe("NavItem", () => {
  it("marks the active row with aria-current and the accent look", () => {
    render(
      <>
        <NavItem active onClick={() => {}}>General</NavItem>
        <NavItem active={false} onClick={() => {}}>Calendar</NavItem>
      </>
    );
    const on = screen.getByRole("button", { name: "General" });
    const off = screen.getByRole("button", { name: "Calendar" });
    expect(on).toHaveAttribute("aria-current", "page");
    expect(off).not.toHaveAttribute("aria-current");
    expect(on.className).toContain("bg-accent-light");
    expect(off.className).toContain("text-muted");
  });

  it("calls onClick and renders its icon", () => {
    const onClick = vi.fn();
    render(<NavItem active={false} icon={<svg data-testid="icon" />} onClick={onClick}>Profile</NavItem>);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("navItemClass sizes and fill", () => {
    expect(navItemClass({ active: false, size: "md" })).toContain("text-sm");
    expect(navItemClass({ active: false })).toContain("text-xs");
    expect(navItemClass({ active: false, fill: false })).not.toContain("w-full");
  });
});
