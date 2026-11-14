import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HubsCard } from "../components/settings/HubsCard";
import { ConfirmHost } from "../components/ui/ConfirmDialog";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const view = (over: Record<string, unknown> = {}) => ({
  id: "h1", name: "Demo hub", colour: "purple", folder: "/data/demo-hub", program: "/bin/sh", args: ["connector.sh", "two words"], problemKind: null, approved: true, waiting: 3, fresh: true,
  checkedAt: Date.now() - 120_000, problem: null, nextTryAt: null, paused: false, busy: false, offers: ["counts"], ...over,
});

let hubs: unknown[] = [];
let saveError: string | null = null;

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HubsCard />
      <ConfirmHost />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hubs = [];
  saveError = null;
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", agentsEnabled: true });
  setInvokeHandler((cmd) => {
    if (cmd === "hubs_counts") return hubs;
    if (cmd === "hubs_save") {
      if (saveError) throw saveError;
      return view();
    }
    return null;
  });
});
afterEach(() => {
  cleanup();
  useAppStore.setState({ agentsEnabled: false });
  setInvokeHandler(null);
});

describe("HubsCard", () => {
  it("lists two hubs with their states", async () => {
    hubs = [
      view(),
      view({ id: "h2", name: "Studio B hub", fresh: false, problem: "The connector timed out after 10 seconds.", nextTryAt: new Date(2026, 10, 14, 14, 5).getTime() }),
      view({ id: "h3", name: "Paused hub", paused: true }),
      view({ id: "h4", name: "New hub", approved: false, problem: "Needs allowing: save the hub again to allow its connector." }),
    ];
    show();
    expect(await screen.findByText("Demo hub")).toBeInTheDocument();
    expect(screen.getByText("3 waiting, checked 2 min ago")).toBeInTheDocument();
    expect(screen.getByText("Not reached: The connector timed out after 10 seconds. Next try at 14:05")).toBeInTheDocument();
    expect(screen.getByText("Paused after 6 failed tries")).toBeInTheDocument();
    expect(screen.getByText("Needs allowing: open it and save")).toBeInTheDocument();
    expect(screen.getAllByText("/data/demo-hub")).toHaveLength(4);
  });

  it("shows the text of a closed gate once, muted, and no hub", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "hubs_counts") throw "Hubs do nothing while an organisation is in test mode.";
      return null;
    });
    show();
    expect(await screen.findByText("Hubs do nothing while an organisation is in test mode.")).toHaveClass("text-muted");
    expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(1);
  });

  it("Remove asks, then removes", async () => {
    hubs = [view()];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Remove Demo hub\? Its projects stay marked as a hub's/)).toBeInTheDocument();
    expect(invokedCommands.some((c) => c.cmd === "hubs_remove")).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).pop()!);
    await waitFor(() => expect(invokedCommands).toContainEqual({ cmd: "hubs_remove", args: { id: "h1" } }));
  });

  it("Try again refreshes the hub", async () => {
    hubs = [view()];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(invokedCommands).toContainEqual({ cmd: "hubs_refresh", args: { id: "h1" } }));
  });

  it("Edit prefills the program and the arguments, and sends them back as they are", async () => {
    hubs = [view()];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Program" })).toHaveValue("/bin/sh");
    expect(screen.getByRole("textbox", { name: /Arguments/ })).toHaveValue("connector.sh\ntwo words");
    expect(screen.queryByText(/enter them again/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(invokedCommands).toContainEqual({
        cmd: "hubs_save",
        args: { hub: { id: "h1", name: "Demo hub", colour: "purple", folder: "/data/demo-hub", program: "/bin/sh", args: ["connector.sh", "two words"] } },
      }),
    );
  });

  it("words a problem in the app's language from its kind, and falls back to the text", async () => {
    hubs = [
      view({ id: "h2", name: "Studio B hub", fresh: false, problem: "The connector timed out after 10 seconds.", problemKind: "timedOut" }),
      view({ id: "h3", name: "Other hub", fresh: false, problem: "Some new text." }),
    ];
    show();
    expect(await screen.findByText("Not reached: the connector took too long to answer")).toBeInTheDocument();
    expect(screen.getByText("Not reached: Some new text.")).toBeInTheDocument();
    cleanup();
    useAppStore.setState({ language: "FR" });
    show();
    expect(await screen.findByText("Injoignable : le connecteur a mis trop de temps à répondre")).toBeInTheDocument();
  });

  it("trims each argument line, drops empty ones and a trailing carriage return", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add a hub" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: "Demo hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Folder" }), { target: { value: "/data/demo-hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Program" }), { target: { value: "/bin/sh" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Arguments/ }), { target: { value: "  connector.sh \r\n \r\n--flag\r\n  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(invokedCommands).toContainEqual({
        cmd: "hubs_save",
        args: { hub: { id: null, name: "Demo hub", colour: "blue", folder: "/data/demo-hub", program: "/bin/sh", args: ["connector.sh", "--flag"] } },
      }),
    );
  });

  it("the form refuses an empty name and sends the arguments split by line", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add a hub" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder" }), { target: { value: "/data/demo-hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Program" }), { target: { value: "/bin/sh" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Arguments/ }), { target: { value: "one\n\ntwo words\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Give the hub a name.")).toBeInTheDocument();
    expect(invokedCommands.some((c) => c.cmd === "hubs_save")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: " Demo hub " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(invokedCommands).toContainEqual({
        cmd: "hubs_save",
        args: { hub: { id: null, name: "Demo hub", colour: "blue", folder: "/data/demo-hub", program: "/bin/sh", args: ["one", "two words"] } },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a cancelled approval keeps the form open with its message", async () => {
    saveError = "Not saved: the connector was not allowed";
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add a hub" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: "Demo hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Folder" }), { target: { value: "/data/demo-hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Program" }), { target: { value: "/bin/sh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Not allowed: nothing was saved.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("another failure shows its own text, as plain text", async () => {
    saveError = "<i>Another hub has this name.</i>";
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add a hub" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: "Demo hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Folder" }), { target: { value: "/data/demo-hub" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Program" }), { target: { value: "/bin/sh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("<i>Another hub has this name.</i>")).toBeInTheDocument();
  });
});
