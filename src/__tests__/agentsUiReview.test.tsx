import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Pencil } from "lucide-react";
import { AgentDetail } from "../components/agents/AgentDetail";
import { AgentList } from "../components/agents/AgentList";
import { Conversation } from "../components/agents/Conversation";
import { PromptAnswer } from "../components/agents/PromptAnswer";
import { StartAgentForm } from "../components/agents/StartAgentForm";
import { IconButton } from "../components/ui/IconButton";
import { Textarea } from "../components/ui/Input";
import { agentGroupDotClass, agentGroupTextClass, routineRunTextClass } from "../lib/statusColors";
import { logError } from "../lib/log";
import { setInvokeHandler, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Agent, Group, Prompt } from "../lib/agents";

vi.mock("../lib/log", () => ({ logError: vi.fn(() => Promise.resolve()) }));

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
    modelLabel: null,
    ...over,
  };
}

const prompt: Prompt = {
  question: "Run this command?",
  detail: "",
  fingerprint: "fp-1",
  options: [
    { number: 1, label: "Yes", selected: true },
    { number: 2, label: "No", selected: false },
  ],
};

beforeEach(() => {
  clearInvokedCommands();
  vi.mocked(logError).mockClear();
  localStorage.clear();
});

describe("statusColors: agent groups", () => {
  it("dots are solid fills: working is the info token and pulses, idle the checkbox border", () => {
    expect(agentGroupDotClass("working")).toBe("bg-info animate-pulse");
    expect(agentGroupDotClass("idle")).toBe("bg-checkbox-border");
    expect(agentGroupDotClass("needs-you")).toBe("bg-warning");
    expect(agentGroupDotClass("done")).toBe("bg-success");
    for (const g of ["needs-you", "working", "idle", "done"] as Group[]) {
      expect(agentGroupDotClass(g)).not.toContain("-text");
    }
  });

  it("text classes follow the badge tones", () => {
    expect(agentGroupTextClass("working")).toContain("info-text");
    expect(agentGroupTextClass("needs-you")).toContain("warning-text");
    expect(agentGroupTextClass("done")).toContain("success-text");
    expect(agentGroupTextClass("idle")).toBe("text-muted");
  });

  it("a routine's run uses the agent colours, failed is danger", () => {
    expect(routineRunTextClass("running")).toBe(agentGroupTextClass("working"));
    expect(routineRunTextClass("done")).toBe(agentGroupTextClass("done"));
    expect(routineRunTextClass("failed")).toContain("danger-text");
  });

  it("AgentList draws its dots from the helpers", () => {
    const { container } = render(
      <AgentList
        byGroup={{ "needs-you": [], working: [agent({ group: "working", name: "busy" })], idle: [agent({ sessionId: "s2", name: "calm" })], done: [] }}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const dots = Array.from(container.querySelectorAll(".dot")).map((d) => d.className);
    expect(dots.some((c) => c.includes("bg-info"))).toBe(true);
    expect(dots.some((c) => c.includes("bg-checkbox-border"))).toBe(true);
    expect(dots.some((c) => c.includes("info-text"))).toBe(false);
  });
});

describe("Textarea composer", () => {
  it("frames the field with its controls inside; className goes on the frame", () => {
    render(
      <Textarea
        variant="composer"
        aria-label="Message"
        className="frame-extra"
        textareaClassName="field-extra"
        leading={<button type="button">Attach</button>}
        trailing={<button type="button">Send</button>}
        attachments={<span>thumb</span>}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box.className).toContain("field-extra");
    expect(box.className).toContain("bg-transparent");
    expect(box.className).not.toContain("frame-extra");
    const frame = box.closest(".frame-extra") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toContain("rounded-xl");
    expect(frame.className).toContain("focus-within:border-accent");
    expect(frame).toContainElement(screen.getByRole("button", { name: "Attach" }));
    expect(frame).toContainElement(screen.getByRole("button", { name: "Send" }));
    expect(frame).toHaveTextContent("thumb");
  });

  it("highlight gives the frame the accent border", () => {
    const { rerender } = render(<Textarea variant="composer" aria-label="Message" className="f" />);
    const frame = () => screen.getByRole("textbox").closest(".f") as HTMLElement;
    expect(frame().className).toContain("border-[var(--color-input-border)]");
    rerender(<Textarea variant="composer" aria-label="Message" className="f" highlight />);
    expect(frame().className).toMatch(/(^| )border-accent( |$)/);
  });

  it("other variants ignore the slots and render a bare textarea", () => {
    const { container } = render(<Textarea aria-label="Notes" trailing={<span>x</span>} />);
    expect(container.firstElementChild?.tagName).toBe("TEXTAREA");
    expect(container).not.toHaveTextContent("x");
  });
});

describe("IconButton floating", () => {
  it("is round and pinned to the parent's corner, on a bordered surface", () => {
    render(<IconButton icon={Pencil} label="Remove" size="xs" floating />);
    const cls = screen.getByRole("button", { name: "Remove" }).className;
    for (const c of ["absolute", "-top-1.5", "-right-1.5", "rounded-full", "border", "bg-[var(--color-surface)]"]) {
      expect(cls.split(" ")).toContain(c);
    }
    expect(cls.split(" ")).not.toContain("rounded");
  });

  it("keeps its size radius when not floating", () => {
    render(<IconButton icon={Pencil} label="Edit" />);
    const cls = screen.getByRole("button", { name: "Edit" }).className.split(" ");
    expect(cls).toContain("rounded-md");
    expect(cls).not.toContain("absolute");
  });
});

describe("AgentDetail composer", () => {
  beforeEach(() => {
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? [] : null));
  });

  it("Send is an icon button named Send, and the box has its own name", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toHaveAttribute("aria-label", "Send");
    expect(send).toHaveTextContent("");
    expect(send.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Message to the agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add image" })).toBeInTheDocument();
  });

  it("a disabled box is described by the reason", async () => {
    render(<AgentDetail agent={agent({ kind: "interactive" })} onOpenTerminal={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Message to the agent" })).toHaveAccessibleDescription(
      "Messages can only be sent to background agents. Use the terminal.",
    );
  });

  it("a failed send shows a translated danger Callout and logs the raw error", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "agents_conversation") return [];
      if (cmd === "agents_send") throw "pipe closed: EPIPE";
      return null;
    });
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the agent" }), { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't send the message");
    expect(alert).not.toHaveTextContent("EPIPE");
    expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.any(String), "pipe closed: EPIPE");
  });
});

describe("live regions", () => {
  it("the conversation is a polite log once loaded", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? [{ kind: "assistant", text: "Hi", at: null }] : null));
    render(<Conversation sessionId="sess-1" working={false} />);
    await screen.findByText("Hi");
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveTextContent("Hi");
  });

  it("the prompt sits in a polite log mounted before it loads", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_prompt" ? prompt : null));
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    const log = screen.getByRole("log", { name: "Needs you" });
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toBeEmptyDOMElement();
    expect(await screen.findByText("Run this command?")).toBeInTheDocument();
    expect(log).toHaveTextContent("Run this command?");
  });
});

describe("PromptAnswer", () => {
  it("the terminal's default option is aria-current and named as the default, not a toggle", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_prompt" ? prompt : null));
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    await screen.findByText("Run this command?");
    const yes = screen.getByRole("button", { name: "1. Yes (default)" });
    expect(yes).toHaveAttribute("aria-current", "true");
    expect(yes).not.toHaveAttribute("aria-pressed");
    expect(yes.querySelector(".sr-only")).toHaveTextContent("(default)");
    const no = screen.getByRole("button", { name: "2. No" });
    expect(no).not.toHaveAttribute("aria-current");
    expect(no).not.toHaveAttribute("aria-pressed");
  });

  it("a failed answer shows a translated danger Callout", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "agents_prompt") return prompt;
      if (cmd === "agents_answer") throw "fingerprint mismatch";
      return null;
    });
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    await screen.findByText("Run this command?");
    fireEvent.click(screen.getByRole("button", { name: /No/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't send the answer");
    expect(alert).not.toHaveTextContent("fingerprint");
    expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.any(String), "fingerprint mismatch");
  });
});

describe("StartAgentForm", () => {
  it("a failed folder list shows a translated danger Callout", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start_folders") throw "claude not found";
      return null;
    });
    render(<StartAgentForm onStarted={() => {}} onCancel={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the folders");
    expect(alert).not.toHaveTextContent("claude not found");
    await waitFor(() => expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.any(String), "claude not found"));
  });
});
