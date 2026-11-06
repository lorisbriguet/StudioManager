import { describe, it, expect } from "vitest";
import { pdfFileName, uniquePdfFileName, safeFileName, uniqueFileName } from "../lib/pdfFilename";

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

describe("safeFileName", () => {
  it("replaces path separators", () => {
    expect(safeFileName("A/B\\C")).toBe("A_B_C");
  });

  it("drops control characters and leading dots", () => {
    expect(safeFileName("..hidden\x00name\n")).toBe("hiddenname");
  });
});

describe("uniqueFileName", () => {
  it("keeps the given extension and suffixes before it", () => {
    const used = new Set<string>();
    expect(uniqueFileName("D-26-001_Swisscom", "jpg", used)).toBe("D-26-001_Swisscom.jpg");
    expect(uniqueFileName("D-26-001_Swisscom", "jpg", used)).toBe("D-26-001_Swisscom_2.jpg");
  });

  it("sanitises the stem and the extension", () => {
    const used = new Set<string>();
    expect(uniqueFileName("D-26-002_Migros/Coop", "p/df", used)).toBe("D-26-002_Migros_Coop.p_df");
  });

  it("writes no trailing dot when there is no extension", () => {
    expect(uniqueFileName("README", "", new Set())).toBe("README");
  });
});
