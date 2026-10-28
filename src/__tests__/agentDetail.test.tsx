import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AgentDetail } from "../components/agents/AgentDetail";
import { PromptAnswer } from "../components/agents/PromptAnswer";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Agent, Prompt } from "../lib/agents";

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
  detail: "npm test",
  fingerprint: "fp-1",
  options: [
    { number: 1, label: "Yes", selected: true },
    { number: 2, label: "No", selected: false },
  ],
};

describe("AgentDetail", () => {
  beforeEach(() => {
    clearInvokedCommands();
    setInvokeHandler((cmd) => {
      if (cmd === "agents_conversation") return [{ kind: "assistant", text: "Hello there", at: null }];
      if (cmd === "agents_prompt") return null;
      return null;
    });
  });

  it("shows the conversation", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    expect(await screen.findByText("Hello there")).toBeInTheDocument();
  });

  it("message box disabled when waiting", async () => {
    render(<AgentDetail agent={agent({ status: "waiting", group: "needs-you" })} onOpenTerminal={() => {}} />);
    await screen.findByText("Hello there");
    expect(screen.getByPlaceholderText("Message to the agent")).toBeDisabled();
  });

  it("message box disabled for interactive", async () => {
    render(<AgentDetail agent={agent({ kind: "interactive" })} onOpenTerminal={() => {}} />);
    await screen.findByText("Hello there");
    expect(screen.getByPlaceholderText("Message to the agent")).toBeDisabled();
  });

  it("sends a message from an enabled box", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const box = screen.getByPlaceholderText("Message to the agent");
    fireEvent.change(box, { target: { value: "go on" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_send")?.args).toEqual({
        sessionId: "sess-1",
        text: "go on",
      }),
    );
  });

  it("Enter sends, Shift+Enter does not", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    const box = screen.getByPlaceholderText("Message to the agent");
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(invokedCommands.some((c) => c.cmd === "agents_send")).toBe(false);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_send")?.args).toEqual({ sessionId: "sess-1", text: "line one" }),
    );
  });

  it("no switch-model for interactive", async () => {
    const { rerender } = render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    rerender(<AgentDetail agent={agent({ kind: "interactive" })} onOpenTerminal={() => {}} />);
    expect(screen.queryByLabelText("Model")).toBeNull();
  });

  it("switches model", async () => {
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    fireEvent.click(screen.getByLabelText("Model"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Opus 5.5" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_switch_model")?.args).toEqual({
        sessionId: "sess-1",
        model: "opus",
      }),
    );
  });

  it("passes the new short id up after a model switch", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_switch_model" ? "abcd1234" : null));
    let switched = "";
    render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} onSwitched={(id) => (switched = id)} />);
    fireEvent.click(screen.getByLabelText("Model"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Opus 5.5" }));
    await waitFor(() => expect(switched).toBe("abcd1234"));
  });

  it("dismiss only appears in needs you", () => {
    const { rerender } = render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    rerender(<AgentDetail agent={agent({ group: "needs-you", status: "waiting" })} onOpenTerminal={() => {}} />);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("open terminal reports the short id", () => {
    let opened = "";
    render(<AgentDetail agent={agent()} onOpenTerminal={(id) => (opened = id)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));
    expect(opened).toBe("abcd1234");
  });
});

describe("PromptAnswer", () => {
  beforeEach(() => clearInvokedCommands());

  it("prompt buttons call answerPrompt with number, label and fingerprint", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_prompt" ? prompt : null));
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    expect(await screen.findByText("Run this command?")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /No/ }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_answer")?.args).toEqual({
        shortId: "abcd1234",
        number: 2,
        label: "No",
        fingerprint: "fp-1",
      }),
    );
  });

  it("prompt error falls back to terminal hint", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "agents_prompt") throw "cannot read screen";
      return null;
    });
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    expect(await screen.findByText("Answer this one in the terminal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeInTheDocument();
  });

  it("free-text options are not buttons", async () => {
    setInvokeHandler((cmd) =>
      cmd === "agents_prompt"
        ? {
            ...prompt,
            options: [...prompt.options, { number: 3, label: "Type something.", selected: false }],
          }
        : null,
    );
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    await screen.findByText("Run this command?");
    expect(screen.queryByRole("button", { name: /Type something/ })).toBeNull();
    expect(screen.getByText("Answer this one in the terminal")).toBeInTheDocument();
  });

  it("buttons disabled while answering", async () => {
    let release: () => void = () => {};
    setInvokeHandler((cmd) => {
      if (cmd === "agents_prompt") return prompt;
      if (cmd === "agents_answer") return new Promise<void>((r) => (release = r));
      return null;
    });
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    await screen.findByText("Run this command?");
    fireEvent.click(screen.getByRole("button", { name: /Yes/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /No/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /Yes/ })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: /No/ })).not.toBeDisabled());
  });
});

describe("polling", () => {
  beforeEach(() => {
    clearInvokedCommands();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const count = (cmd: string) => invokedCommands.filter((c) => c.cmd === cmd).length;

  it("conversation skips a tick while a call is in flight", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_conversation" ? new Promise(() => {}) : null));
    render(<AgentDetail agent={agent({ group: "working" })} onOpenTerminal={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(count("agents_conversation")).toBe(1);
  });

  it("prompt poll skips a tick while a call is in flight", async () => {
    setInvokeHandler((cmd) => (cmd === "agents_prompt" ? new Promise(() => {}) : null));
    render(<PromptAnswer shortId="abcd1234" onOpenTerminal={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(count("agents_prompt")).toBe(1);
  });

  it("a conversation response arriving after the agent changed is not shown", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    setInvokeHandler((cmd, args) => {
      if (cmd !== "agents_conversation") return null;
      if (args.sessionId === "sess-1") return new Promise((r) => (resolveOld = r));
      return [{ kind: "assistant", text: "from two", at: null }];
    });
    const { rerender } = render(<AgentDetail agent={agent()} onOpenTerminal={() => {}} />);
    rerender(<AgentDetail agent={agent({ sessionId: "sess-2" })} onOpenTerminal={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("from two")).toBeInTheDocument();
    await act(async () => {
      resolveOld([{ kind: "assistant", text: "from one", at: null }]);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByText("from one")).toBeNull();
    expect(screen.getByText("from two")).toBeInTheDocument();
  });

  it("a prompt response arriving after the agent changed is not shown", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    setInvokeHandler((cmd, args) => {
      if (cmd !== "agents_prompt") return null;
      if (args.shortId === "aaaaaaaa") return new Promise((r) => (resolveOld = r));
      return { ...prompt, question: "Second?" };
    });
    const { rerender } = render(<PromptAnswer shortId="aaaaaaaa" onOpenTerminal={() => {}} />);
    rerender(<PromptAnswer shortId="bbbbbbbb" onOpenTerminal={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("Second?")).toBeInTheDocument();
    await act(async () => {
      resolveOld({ ...prompt, question: "First?" });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByText("First?")).toBeNull();
    expect(screen.getByText("Second?")).toBeInTheDocument();
  });
});
