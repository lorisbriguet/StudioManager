import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { ConfirmHost } from "../components/ui/ConfirmDialog";
import { confirm, confirmDelete } from "../lib/confirm";
import { confirmIfDirty, registerDirtyGuard } from "../lib/dirty-guard";
import { useAppStore } from "../stores/app-store";
import { useConfirmStore } from "../stores/confirm-store";

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
});
afterEach(cleanup);

/** Ask from outside React (like lib code does) and render the host. */
function ask<T>(question: () => Promise<T>) {
  render(<ConfirmHost />);
  let answer!: Promise<T>;
  act(() => {
    answer = question();
  });
  return answer;
}

describe("ConfirmDialog", () => {
  it("puts the verb on the button, red when the tone is danger, and resolves true", async () => {
    const answer = ask(() =>
      confirm({ title: "Delete Atelier?", message: "Its folder goes to the Trash.", confirmLabel: "Delete", tone: "danger" })
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete Atelier?" });
    expect(dialog).toHaveTextContent("Its folder goes to the Trash.");
    const verb = screen.getByRole("button", { name: "Delete" });
    expect(verb.className).toContain("danger");
    fireEvent.click(verb);
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses Cancel, and Cancel resolves false", async () => {
    const answer = ask(() => confirm({ title: "Restore?", confirmLabel: "Restore" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    // tone default: the verb is the primary button, not a red one
    expect(screen.getByRole("button", { name: "Restore" }).className).not.toContain("danger-text");
    fireEvent.click(cancel);
    await expect(answer).resolves.toBe(false);
  });

  it("cancels on Escape", async () => {
    const answer = ask(() => confirm({ title: "Leave without saving?", confirmLabel: "Leave", cancelLabel: "Stay" }));
    await screen.findByRole("button", { name: "Stay" });
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(answer).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the verb disabled until the required text is typed", async () => {
    const answer = ask(() => confirm({ title: "Delete Label?", confirmLabel: "Delete", tone: "danger", requireText: "Label" }));
    const verb = await screen.findByRole("button", { name: "Delete" });
    expect(verb).toBeDisabled();
    const field = screen.getByPlaceholderText("Label");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Lab" } });
    expect(verb).toBeDisabled();
    fireEvent.change(field, { target: { value: "Label" } });
    expect(verb).toBeEnabled();
    fireEvent.keyDown(field, { key: "Enter" });
    await expect(answer).resolves.toBe(true);
  });

  it("resolves the extra choice to its value", async () => {
    const answer = ask(() =>
      confirm({ title: "Export a draft?", confirmLabel: "Mark as sent & export", extra: { label: "Export as draft", value: "draft" } })
    );
    const footerButtons = (await screen.findByRole("button", { name: "Export as draft" })).parentElement!.querySelectorAll("button");
    // Cancel · extra · verb
    expect(Array.from(footerButtons).map((b) => b.textContent)).toEqual(["Cancel", "Export as draft", "Mark as sent & export"]);
    fireEvent.click(screen.getByRole("button", { name: "Export as draft" }));
    await expect(answer).resolves.toBe("draft");
  });

  it("asks one question at a time, in order", async () => {
    render(<ConfirmHost />);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = confirmDelete("A");
      second = confirmDelete("B");
    });
    expect(await screen.findByRole("dialog", { name: "Delete A?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await expect(first).resolves.toBe(true);
    expect(await screen.findByRole("dialog", { name: "Delete B?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBe(false);
    expect(useConfirmStore.getState().queue).toHaveLength(0);
  });

  it("is reachable from non-React code: the unsaved-changes guard", async () => {
    render(<ConfirmHost />);
    const unregister = registerDirtyGuard(() => true, () => {});
    let leaving!: Promise<boolean>;
    act(() => {
      leaving = confirmIfDirty("/elsewhere");
    });
    expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await expect(leaving).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    unregister();
  });
});
