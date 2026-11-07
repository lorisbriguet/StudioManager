import { describe, it, expect } from "vitest";
import { documentPdfStem, pdfFileName, safeFileName, uniqueFileName } from "../lib/pdfFilename";

describe("pdfFileName", () => {
  it("adds the .pdf extension", () => {
    expect(pdfFileName("2026-0042_Acme AG")).toBe("2026-0042_Acme AG.pdf");
  });

  it("replaces forward slashes so the name cannot traverse directories", () => {
    expect(pdfFileName("2026-0042_A/B GmbH")).toBe("2026-0042_A_B GmbH.pdf");
  });

  it("replaces backslashes", () => {
    expect(pdfFileName("REF\\1_Client\\Sub")).toBe("REF_1_Client_Sub.pdf");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(pdfFileName("a/b/c_d/e")).toBe("a_b_c_d_e.pdf");
  });
});

describe("documentPdfStem", () => {
  const issued = { reference: "2026-0042", status: "sent", language: "FR", date: "2026-11-03" };
  const draft = { reference: "DRAFT-0b6f1c2e-uuid", status: "draft", language: "FR", date: "2026-11-03" };

  it("names an issued document <Reference>_<Client>", () => {
    expect(documentPdfStem("invoice", issued, "Acme AG")).toBe("2026-0042_Acme AG");
    expect(documentPdfStem("quote", { ...issued, reference: "D-2026-007" }, "Acme AG")).toBe("D-2026-007_Acme AG");
  });

  it("names a French draft Brouillon-facture / Brouillon-offre with the document date, never the internal id", () => {
    expect(documentPdfStem("invoice", draft, "Acme AG")).toBe("Brouillon-facture_Acme AG_2026-11-03");
    expect(documentPdfStem("quote", draft, "Acme AG")).toBe("Brouillon-offre_Acme AG_2026-11-03");
  });

  it("names an English draft Draft-invoice / Draft-quote", () => {
    const en = { ...draft, language: "EN" };
    expect(documentPdfStem("invoice", en, "Acme AG")).toBe("Draft-invoice_Acme AG_2026-11-03");
    expect(documentPdfStem("quote", en, "Acme AG")).toBe("Draft-quote_Acme AG_2026-11-03");
  });

  it("treats a draft-status document with a real reference as a draft (isDraftDocument)", () => {
    expect(documentPdfStem("quote", { ...draft, reference: "D-2026-005" }, "Acme AG")).toBe("Brouillon-offre_Acme AG_2026-11-03");
  });

  it("keeps only the date part of a timestamp and drops a missing date", () => {
    expect(documentPdfStem("invoice", { ...draft, date: "2026-11-03T10:00:00" }, "Acme")).toBe("Brouillon-facture_Acme_2026-11-03");
    expect(documentPdfStem("invoice", { ...draft, date: null }, "Acme")).toBe("Brouillon-facture_Acme");
  });

  it("stays path-safe and gets _2 when two drafts share a client and date in one batch", () => {
    const used = new Set<string>();
    const stem = documentPdfStem("invoice", draft, "A/B GmbH");
    expect(uniqueFileName(stem, "pdf", used)).toBe("Brouillon-facture_A_B GmbH_2026-11-03.pdf");
    expect(uniqueFileName(stem, "pdf", used)).toBe("Brouillon-facture_A_B GmbH_2026-11-03_2.pdf");
  });
});

describe("uniqueFileName for PDFs", () => {
  it("returns the plain name when unused and records it", () => {
    const used = new Set<string>();
    expect(uniqueFileName("2026-0042_Acme AG", "pdf", used)).toBe("2026-0042_Acme AG.pdf");
    expect(used.has("2026-0042_acme ag.pdf")).toBe(true);
  });

  it("suffixes _2, then _3 on repeated collisions (two draft quotes, same client)", () => {
    const used = new Set<string>();
    expect(uniqueFileName("DRAFT_Client", "pdf", used)).toBe("DRAFT_Client.pdf");
    expect(uniqueFileName("DRAFT_Client", "pdf", used)).toBe("DRAFT_Client_2.pdf");
    expect(uniqueFileName("DRAFT_Client", "pdf", used)).toBe("DRAFT_Client_3.pdf");
  });

  it("compares case-insensitively (macOS volumes usually are)", () => {
    const used = new Set<string>();
    uniqueFileName("DRAFT_Acme", "pdf", used);
    expect(uniqueFileName("draft_ACME", "pdf", used)).toBe("draft_ACME_2.pdf");
  });

  it("detects collisions introduced by sanitization", () => {
    const used = new Set<string>();
    uniqueFileName("REF_A/B", "pdf", used);
    expect(uniqueFileName("REF_A\\B", "pdf", used)).toBe("REF_A_B_2.pdf");
  });

  it("skips over an already-reserved suffixed name", () => {
    const used = new Set<string>();
    uniqueFileName("DRAFT_Client_2", "pdf", used); // reserves "DRAFT_Client_2.pdf"
    uniqueFileName("DRAFT_Client", "pdf", used); // reserves "DRAFT_Client.pdf"
    expect(uniqueFileName("DRAFT_Client", "pdf", used)).toBe("DRAFT_Client_3.pdf");
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
