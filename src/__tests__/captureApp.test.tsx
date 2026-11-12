import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CaptureApp } from "../capture/CaptureApp";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { emit } from "../__mocks__/tauri-event";
import { useAppStore } from "../stores/app-store";

const field = () => screen.getByRole("textbox", { name: "Note a thought…" });
const calls = (cmd: string) => invokedCommands.filter((c) => c.cmd === cmd);

describe("CaptureApp", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
    useAppStore.setState({ language: "EN" });
    setInvokeHandler((cmd) => (cmd === "capture_add" ? 1 : cmd === "capture_projects" ? [] : null));
  });

  it("Enter saves with the hotkey source and hides the panel", async () => {
    render(<CaptureApp />);
    fireEvent.change(field(), { target: { value: "Try a wider grid" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(calls("capture_hide")).toHaveLength(1));
    expect(calls("capture_add")[0].args).toEqual({ text: "Try a wider grid", projectId: null, source: "hotkey" });
  });

  it("Escape hides the panel without saving", () => {
    render(<CaptureApp />);
    fireEvent.change(field(), { target: { value: "half a thought" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(calls("capture_hide")).toHaveLength(1);
    expect(calls("capture_add")).toHaveLength(0);
  });

  it("starts empty each time the panel shows", async () => {
    render(<CaptureApp />);
    fireEvent.change(field(), { target: { value: "left over" } });
    expect(field()).toHaveValue("left over");
    await act(async () => {
      await emit("capture:shown");
    });
    expect(field()).toHaveValue("");
  });
});
