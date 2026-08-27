import { describe, it, expect, vi, beforeEach } from "vitest";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { runBulkPdfExport } from "../lib/bulkPdfExport";

// plugin-dialog and plugin-fs both alias to the same catch-all mock module,
// so a single vi.mock must provide every export used by the code under test.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const LABELS = {
  export_pdfs: "Export PDFs",
  bulk_export_draft_warning: "Includes drafts",
  pdf_generation_busy: "Busy",
  bulk_export_progress: "{n}/{total}",
  bulk_export_done: "Done {n}",
  bulk_export_partial: "Partial {n}/{total}",
  cancel: "Cancel",
};

const bytes = new Uint8Array([1]);
const okResult = (reference: string) => ({ bytes, reference, client: { name: "ACME" } });

beforeEach(() => {
  vi.mocked(ask).mockReset().mockResolvedValue(true);
  vi.mocked(open).mockReset().mockResolvedValue("/out");
  vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.info).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
});

describe("runBulkPdfExport", () => {
  it("exports every doc with batch-deduped filenames and clears busy ids", async () => {
    const busyIds = new Set<number>();
    const onDone = vi.fn();
    await runBulkPdfExport({
      docs: [
        { id: 1, reference: "DRAFT-a" },
        { id: 2, reference: "DRAFT-a" }, // same ref + client -> must dedupe
      ],
      busyIds,
      t: LABELS,
      generate: async () => okResult("DRAFT"),
      notFoundMessage: "not found",
      logLabel: "invoice",
      onDone,
    });
    const paths = vi.mocked(writeFile).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/out/DRAFT_ACME.pdf", "/out/DRAFT_ACME_2.pdf"]);
    expect(toast.success).toHaveBeenCalled();
    expect(busyIds.size).toBe(0);
    expect(onDone).toHaveBeenCalled();
  });

  it("bails out with an info toast when a doc is already generating", async () => {
    const busyIds = new Set<number>([2]);
    await runBulkPdfExport({
      docs: [{ id: 2, reference: "2026-002" }],
      busyIds,
      t: LABELS,
      generate: async () => okResult("2026-002"),
      notFoundMessage: "not found",
      logLabel: "invoice",
      onDone: vi.fn(),
    });
    expect(toast.info).toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("stops cleanly when the draft warning is declined", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    await runBulkPdfExport({
      docs: [{ id: 1, reference: "DRAFT-x" }],
      busyIds: new Set<number>(),
      t: LABELS,
      generate: async () => okResult("DRAFT"),
      notFoundMessage: "not found",
      logLabel: "invoice",
      onDone: vi.fn(),
    });
    expect(open).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("stops cleanly when the folder dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const busyIds = new Set<number>();
    await runBulkPdfExport({
      docs: [{ id: 1, reference: "2026-001" }],
      busyIds,
      t: LABELS,
      generate: async () => okResult("2026-001"),
      notFoundMessage: "not found",
      logLabel: "invoice",
      onDone: vi.fn(),
    });
    expect(writeFile).not.toHaveBeenCalled();
    expect(busyIds.size).toBe(0);
  });

  it("isolates per-doc failures and reports a partial summary", async () => {
    const busyIds = new Set<number>();
    await runBulkPdfExport({
      docs: [
        { id: 1, reference: "2026-001" },
        { id: 2, reference: "2026-002" },
      ],
      busyIds,
      t: LABELS,
      generate: async (d) => {
        if (d.id === 1) throw new Error("boom");
        return okResult(d.reference);
      },
      notFoundMessage: "not found",
      logLabel: "invoice",
      onDone: vi.fn(),
    });
    expect(vi.mocked(writeFile).mock.calls).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalled();
    expect(busyIds.size).toBe(0);
  });
});
