import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ProgressBar, Callout, ConfirmButton, DragHandle } from "../components/ui/Feedback";
import { Tooltip } from "../components/ui/Tooltip";
import { useAppStore } from "../stores/app-store";

afterEach(cleanup);
beforeEach(() => useAppStore.setState({ language: "EN" }));

describe("ProgressBar", () => {
  it("clamps and reports its value", () => {
    render(<ProgressBar value={140} label="Progress" showValue />);
    const bar = screen.getByRole("progressbar", { name: "Progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("Callout", () => {
  it("shows its message and action; danger is an alert", () => {
    render(<Callout tone="danger" action={<button type="button">Fix</button>}>2 receipts have no category.</Callout>);
    expect(screen.getByRole("alert")).toHaveTextContent("2 receipts have no category.");
    expect(screen.getByRole("button", { name: "Fix" })).toBeInTheDocument();
  });
});

describe("ConfirmButton", () => {
  it("asks first, runs on confirm", () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" question="Delete this client?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this client?")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels with Cancel, Esc, or a click elsewhere", () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" question="Sure?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Sure?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(screen.queryByText("Sure?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Sure?")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("DragHandle", () => {
  it("is labelled and passes dnd-kit props through", () => {
    const onPointerDown = vi.fn();
    render(<DragHandle role="button" tabIndex={0} onPointerDown={onPointerDown} reveal />);
    const handle = screen.getByRole("button", { name: "Drag to reorder" });
    fireEvent.pointerDown(handle);
    expect(onPointerDown).toHaveBeenCalled();
    expect(handle.className).toContain("group-hover:opacity-100");
  });
});

describe("Tooltip", () => {
  it("shows after a short hover and keeps the child's own handlers", () => {
    vi.useFakeTimers();
    const own = vi.fn();
    render(
      <Tooltip content="Open full page">
        <a href="#p" onMouseEnter={own}>
          open
        </a>
      </Tooltip>
    );
    const link = screen.getByRole("link", { name: "open" });
    fireEvent.mouseEnter(link);
    expect(own).toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Open full page");
    fireEvent.mouseLeave(link);
    expect(screen.queryByRole("tooltip")).toBeNull();
    vi.useRealTimers();
  });
});
