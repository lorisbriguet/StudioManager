import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The full-screen error shown when startup or the schema fails. Rust keeps the
// startup error until retry_init runs the startup again, so Retry must ask for
// that before it reloads, or the same error comes back forever.
const calls: string[] = [];
let retryResult: Promise<unknown> = Promise.resolve(null);
const exit = vi.fn();
// api/core and plugin-process share one stub file in vitest.config.ts, so one mock serves both.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    calls.push(cmd);
    return cmd === "retry_init" ? retryResult : Promise.resolve(null);
  }),
  exit: (code: number) => exit(code),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));
vi.mock("../lib/log", () => ({ logError: vi.fn() }));

let reload: ReturnType<typeof vi.fn>;

async function show(err: unknown) {
  vi.resetModules();
  const { showFatalDbError } = await import("../db/index");
  showFatalDbError(err);
  const overlay = document.querySelector<HTMLElement>(".db-fatal")!;
  const button = (label: string) =>
    [...overlay.querySelectorAll("button")].find((b) => b.textContent === label)!;
  return { overlay, button };
}

beforeEach(() => {
  calls.length = 0;
  retryResult = Promise.resolve(null);
  exit.mockReset();
  reload = vi.fn(() => calls.push("reload"));
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll(".db-fatal").forEach((el) => el.remove());
});

describe("fatal overlay", () => {
  it("Retry runs the startup again in Rust, then reloads", async () => {
    const { button } = await show(new Error("open orgs/sr62vv/studiomanager.db: unable to open database file"));
    button("Retry").click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["retry_init", "reload"]);
  });

  it("still reloads when retry_init itself fails", async () => {
    retryResult = Promise.reject(new Error("Lock error"));
    const { button } = await show(new Error("database is locked"));
    button("Retry").click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("offers Quit, which closes the app", async () => {
    const { button } = await show(new Error("database is locked"));
    button("Quit").click();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("names the missing data folder instead of suggesting a backup", async () => {
    const path = "/Users/x/Library/Application Support/ch.studiomanager/orgs/sr62vv";
    const { overlay } = await show(new Error(`data folder missing: ${path}`));
    expect(overlay.textContent).toContain(
      `Your data folder can't be found: ${path}. If it's on an external or synced disk, connect it and choose Retry.`,
    );
    expect(overlay.textContent).not.toContain("restore a backup");
  });

  it("asks for the latest version when the database is newer than the app", async () => {
    const { overlay } = await show(
      new Error("database newer than this app: it is at schema version 14, this app knows up to 13"),
    );
    expect(overlay.textContent).toContain(
      "This data was saved by a newer version of StudioManager. Install the latest version to open it.",
    );
    expect(overlay.textContent).toContain("schema version 14");
    expect(overlay.textContent).not.toContain("restore a backup");
  });

  it("keeps the generic message and the error for other failures", async () => {
    const { overlay } = await show(new Error("unable to open database file"));
    expect(overlay.textContent).toContain("Database initialization failed");
    expect(overlay.textContent).toContain("unable to open database file");
  });
});
