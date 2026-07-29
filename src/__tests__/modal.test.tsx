import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { Modal } from "../components/ui/Modal";

// All renders are wrapped in StrictMode on purpose: the focus capture/restore
// logic must survive React 19's double render and double effect invocation.

function Harness({ removableTrigger = false }: { removableTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showTrigger, setShowTrigger] = useState(true);
  return (
    <div>
      {showTrigger && (
        <button data-testid="trigger" onClick={() => setOpen(true)}>
          Open
        </button>
      )}
      {removableTrigger && (
        <button data-testid="remove-trigger" onClick={() => setShowTrigger(false)}>
          Remove trigger
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Test modal">
        <input data-testid="field" />
        <button data-testid="ok">OK</button>
      </Modal>
    </div>
  );
}

function renderHarness(props?: { removableTrigger?: boolean }) {
  render(
    <StrictMode>
      <Harness {...props} />
    </StrictMode>
  );
  const trigger = screen.getByTestId("trigger");
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger };
}

afterEach(cleanup);

describe("Modal focus management", () => {
  it("focuses the dialog on open", () => {
    renderHarness();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("wraps Tab from the last focusable element to the first", () => {
    renderHarness();
    // Focusables in DOM order: close button (title bar), input, OK button.
    const ok = screen.getByTestId("ok");
    ok.focus();
    fireEvent.keyDown(ok, { key: "Tab" });
    expect(screen.getByLabelText("Close")).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    renderHarness();
    const close = screen.getByLabelText("Close");
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("ok")).toHaveFocus();
  });

  it("moves focus from the dialog itself to the first focusable on Tab", () => {
    renderHarness();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByLabelText("Close")).toHaveFocus();
  });

  it("keeps focus on the dialog when it contains no focusable elements", () => {
    function Bare() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)}>
          <p>Nothing focusable here</p>
        </Modal>
      );
    }
    render(
      <StrictMode>
        <Bare />
      </StrictMode>
    );
    const dialog = screen.getByRole("dialog");
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toHaveFocus();
  });

  it("restores focus to the trigger when closed with Escape", () => {
    const { trigger } = renderHarness();
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not restore focus to a trigger that was removed while the modal was open", () => {
    const { trigger } = renderHarness({ removableTrigger: true });
    fireEvent.click(screen.getByTestId("remove-trigger"));
    expect(trigger.isConnected).toBe(false);
    // Closing must not throw and must not focus the disconnected element.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("restores focus on close when the modal mounts already open (StrictMode remount path)", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { rerender, unmount } = render(
      <StrictMode>
        <Modal open onClose={() => {}} title="Mounted open">
          <button data-testid="ok">OK</button>
        </Modal>
      </StrictMode>
    );
    rerender(
      <StrictMode>
        <Modal open={false} onClose={() => {}} title="Mounted open">
          <button data-testid="ok">OK</button>
        </Modal>
      </StrictMode>
    );
    expect(outside).toHaveFocus();
    unmount();
    outside.remove();
  });
});
