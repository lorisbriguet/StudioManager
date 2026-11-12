import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaptureField } from "../components/agents/CaptureField";
import { MenuBarApp } from "../menubar/MenuBarApp";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";

const projects = [
  { id: 4, name: "Poster tool", client: "Studio A" },
  { id: 9, name: "Identity", client: "Studio B" },
];

function serve(over: Record<string, unknown | (() => never)> = {}) {
  setInvokeHandler((cmd) => {
    if (cmd in over) {
      const v = over[cmd];
      return typeof v === "function" ? (v as () => unknown)() : v;
    }
    if (cmd === "capture_add") return 1;
    if (cmd === "capture_projects") return projects;
    if (cmd === "agents_list") return [];
    return null;
  });
}

const field = () => screen.getByRole("textbox", { name: "Note a thought…" });
const calls = (cmd: string) => invokedCommands.filter((c) => c.cmd === cmd);

describe("CaptureField", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
    useAppStore.setState({ language: "EN" });
    serve();
  });

  it("Enter saves the text with the menu bar source and clears the field", async () => {
    const onSaved = vi.fn();
    render(<CaptureField source="menubar" onSaved={onSaved} />);
    fireEvent.change(field(), { target: { value: "  Try a wider grid  " } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls("capture_add")[0].args).toEqual({ text: "Try a wider grid", projectId: null, source: "menubar" });
    expect(field()).toHaveValue("");
  });

  it("does nothing on Enter when the text is blank, and Shift+Enter does not save", () => {
    render(<CaptureField source="menubar" />);
    fireEvent.change(field(), { target: { value: "   " } });
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.change(field(), { target: { value: "a" } });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(calls("capture_add")).toHaveLength(0);
  });

  it("Tab opens the project picker and a pick is sent as projectId", async () => {
    render(<CaptureField source="hotkey" />);
    fireEvent.change(field(), { target: { value: "Idea" } });
    fireEvent.keyDown(field(), { key: "Tab" });
    const filter = await screen.findByRole("textbox", { name: "Project" });
    await screen.findByRole("option", { name: /Identity/ });
    fireEvent.change(filter, { target: { value: "ident" } });
    expect(screen.queryByRole("option", { name: /Poster tool/ })).toBeNull();
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Identity")).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(calls("capture_add")).toHaveLength(1));
    expect(calls("capture_add")[0].args).toEqual({ text: "Idea", projectId: 9, source: "hotkey" });
  });

  it("Esc in the picker closes only the picker", async () => {
    const onClose = vi.fn();
    render(<CaptureField source="menubar" onClose={onClose} />);
    fireEvent.keyDown(field(), { key: "Tab" });
    const filter = await screen.findByRole("textbox", { name: "Project" });
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    filter.dispatchEvent(esc);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(esc.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the text and shows the message when saving fails", async () => {
    serve({
      capture_add: () => {
        throw "Captures are off while a test mode is on.";
      },
    });
    render(<CaptureField source="menubar" />);
    fireEvent.change(field(), { target: { value: "Keep me" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Captures are off while a test mode is on.");
    expect(field()).toHaveValue("Keep me");
  });

  it("shows the French placeholder", () => {
    useAppStore.setState({ language: "FR" });
    render(<CaptureField source="menubar" />);
    expect(screen.getByRole("textbox", { name: "Noter une idée…" })).toBeInTheDocument();
  });

  it("is shown in the menu bar panel's Agents tab", async () => {
    render(<MenuBarApp />);
    expect(await screen.findByRole("textbox", { name: "Note a thought…" })).toBeInTheDocument();
  });
});
