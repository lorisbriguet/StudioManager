import { describe, it, expect } from "vitest";
import { pdfFileName, uniquePdfFileName } from "../lib/pdfFilename";

describe("pdfFileName", () => {
  it("joins reference and client name with an underscore", () => {
    expect(pdfFileName("2026-0042", "Acme AG")).toBe("2026-0042_Acme AG.pdf");
  });

  it("replaces forward slashes so the name cannot traverse directories", () => {
    expect(pdfFileName("2026-0042", "A/B GmbH")).toBe("2026-0042_A_B GmbH.pdf");
  });

  it("replaces backslashes", () => {
    expect(pdfFileName("REF\\1", "Client\\Sub")).toBe("REF_1_Client_Sub.pdf");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(pdfFileName("a/b/c", "d/e")).toBe("a_b_c_d_e.pdf");
  });
});

describe("uniquePdfFileName", () => {
  it("returns the plain name when unused and records it", () => {
    const used = new Set<string>();
    expect(uniquePdfFileName("2026-0042", "Acme AG", used)).toBe("2026-0042_Acme AG.pdf");
    expect(used.has("2026-0042_acme ag.pdf")).toBe(true);
  });

  it("suffixes _2, then _3 on repeated collisions (two draft quotes, same client)", () => {
    const used = new Set<string>();
    expect(uniquePdfFileName("DRAFT", "Client", used)).toBe("DRAFT_Client.pdf");
    expect(uniquePdfFileName("DRAFT", "Client", used)).toBe("DRAFT_Client_2.pdf");
    expect(uniquePdfFileName("DRAFT", "Client", used)).toBe("DRAFT_Client_3.pdf");
  });

  it("compares case-insensitively (macOS volumes usually are)", () => {
    const used = new Set<string>();
    uniquePdfFileName("DRAFT", "Acme", used);
    expect(uniquePdfFileName("draft", "ACME", used)).toBe("draft_ACME_2.pdf");
  });

  it("detects collisions introduced by sanitization", () => {
    const used = new Set<string>();
    uniquePdfFileName("REF", "A/B", used);
    expect(uniquePdfFileName("REF", "A\\B", used)).toBe("REF_A_B_2.pdf");
  });

  it("skips over an already-reserved suffixed name", () => {
    const used = new Set<string>();
    uniquePdfFileName("DRAFT", "Client_2", used); // reserves "DRAFT_Client_2.pdf"
    uniquePdfFileName("DRAFT", "Client", used); // reserves "DRAFT_Client.pdf"
    expect(uniquePdfFileName("DRAFT", "Client", used)).toBe("DRAFT_Client_3.pdf");
  });
});
