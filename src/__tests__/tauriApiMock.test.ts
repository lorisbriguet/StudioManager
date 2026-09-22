import { describe, it, expect, afterEach } from "vitest";
import { invoke, setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

afterEach(() => { setInvokeHandler(null); clearInvokedCommands(); });

describe("tauri-api mock invoke", () => {
  it("routes commands to the handler and records them", async () => {
    setInvokeHandler((cmd, args) => (cmd === "ping" ? { pong: args.x } : null));
    expect(await invoke("ping", { x: 1 })).toEqual({ pong: 1 });
    expect(invokedCommands).toEqual([{ cmd: "ping", args: { x: 1 } }]);
  });
  it("still batches execute_batch statements", async () => {
    expect(await invoke("execute_batch", { statements: [] })).toEqual({ lastInsertId: 1 });
  });
});
