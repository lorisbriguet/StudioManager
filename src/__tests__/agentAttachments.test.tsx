import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Agent } from "../lib/agents";

type DropEvent = { payload: { type: string; paths?: string[] } };
const drop: { handler: ((e: DropEvent) => void) | null } = { handler: null };
// The webview module shares its mock file with the invoke helpers: keep those, replace the drop listener.
vi.mock("@tauri-apps/api/webview", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentWebview: () => ({
    onDragDropEvent: async (h: (e: DropEvent) => void) => {
      drop.handler = h;
      return () => {
        drop.handler = null;
      };
    },
  }),
}));

import { AgentDetail, appendToDraft, imageTypeOf } from "../components/agents/AgentDetail";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    sessionId: "sess-1",
    shortId: "abcd1234",
    pid: null,
    name: "fix-login",
    cwd: "/work/proj",
    kind: "background",
    status: "idle",
    state: null,
    waitingFor: null,
    startedAt: 0,
    group: "idle",
    quiet: null,
    project: null,
    model: "sonnet",
    ...over,
  };
}

const sendArgs = () => invokedCommands.find((c) => c.cmd === "agents_send")?.args;

describe("attachments", () => {
  beforeEach(() => {
    clearInvokedCommands();
    drop.handler = null;
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    setInvokeHandler(async (cmd) => {
      if (cmd === "agents_save_image") return "/data/agent-uploads/1.png";
      if (cmd === "agents_conversation") return [];
      return undefined;
    });
  });

  it("knows image types by extension and appends to a draft", () => {
    expect(imageTypeOf("/a/b/Shot.PNG")).toBe("image/png");
    expect(imageTypeOf("/a/b/c.jpeg")).toBe("image/jpeg");
    expect(imageTypeOf("/a/b/c.pdf")).toBeNull();
    expect(appendToDraft("", "/x")).toBe("/x");
    expect(appendToDraft("look at", "/x")).toBe("look at /x");
    expect(appendToDraft("look at\n", "/x")).toBe("look at\n/x");
  });

  it("a pasted image shows as a thumbnail and is sent as a saved path", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const box = screen.getByPlaceholderText("Message to the agent");
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { files: [file] } });
    expect(await screen.findByAltText("shot.png")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "what is this?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(sendArgs()).toEqual({ sessionId: "sess-1", text: "what is this?\n\n/data/agent-uploads/1.png" }),
    );
    const save = invokedCommands.find((c) => c.cmd === "agents_save_image")?.args;
    expect(save).toEqual({ mime: "image/png", data: "AQID" });
    await waitFor(() => expect(screen.queryByAltText("shot.png")).toBeNull());
  });

  it("an image alone can be sent, and a removed one is not", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const box = screen.getByPlaceholderText("Message to the agent");
    const a = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const b = new File([new Uint8Array([2])], "b.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { files: [a, b] } });
    await screen.findByAltText("b.png");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove image" })[1]);
    expect(screen.queryByAltText("b.png")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendArgs()).toEqual({ sessionId: "sess-1", text: "/data/agent-uploads/1.png" }));
    expect(invokedCommands.filter((c) => c.cmd === "agents_save_image")).toHaveLength(1);
  });

  it("refuses unsupported pasted files with a message", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const box = screen.getByPlaceholderText("Message to the agent");
    fireEvent.paste(box, { clipboardData: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByText("Only PNG, JPEG, GIF and WebP images can be attached")).toBeInTheDocument();
  });

  it("a dropped non-image file is pasted into the draft as its path", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const box = screen.getByPlaceholderText("Message to the agent") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "read" } });
    await waitFor(() => expect(drop.handler).not.toBeNull());
    await act(async () => drop.handler?.({ payload: { type: "drop", paths: ["/Users/me/Docs/spec.pdf", "/tmp/notes.md"] } }));
    await waitFor(() => expect(box.value).toBe("read /Users/me/Docs/spec.pdf /tmp/notes.md"));
  });

  it("a dropped image is attached as a thumbnail", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    await waitFor(() => expect(drop.handler).not.toBeNull());
    await act(async () => drop.handler?.({ payload: { type: "drop", paths: ["/Users/me/Desktop/screen.png"] } }));
    expect(await screen.findByAltText("screen.png")).toBeInTheDocument();
  });

  it("drops are ignored while the agent can't take a message", async () => {
    render(<AgentDetail agent={agent({ status: "waiting", group: "needs-you" })} onOpenTerminal={() => {}} />);
    await act(async () => {});
    expect(drop.handler).toBeNull();
  });
});
