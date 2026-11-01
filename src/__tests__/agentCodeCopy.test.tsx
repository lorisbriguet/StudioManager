import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import { Conversation } from "../components/agents/Conversation";

describe("code in agent replies", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies a code block with one click", async () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setInvokeHandler((cmd) =>
      cmd === "agents_conversation"
        ? [{ kind: "assistant", text: "Run this:\n\n```bash\nnpm ci\nnpm test\n```\n\nand `inline` stays plain.", at: null }]
        : null,
    );
    render(<Conversation sessionId="00000000-0000-4000-8000-000000000001" working={false} />);
    const button = await screen.findByRole("button", { name: "Copy" });
    // only the block has a button, not the inline code
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("npm ci\nnpm test"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
