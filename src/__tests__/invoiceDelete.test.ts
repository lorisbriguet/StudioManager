import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  deleteInvoice,
  getNextInvoiceReference,
  createInvoiceWithLineItems,
} from "../db/queries/invoices";
import { deleteQuote } from "../db/queries/quotes";
import { deleteClient } from "../db/queries/clients";
import { getDb } from "../db";
import {
  executedStatements,
  clearExecutedStatements,
  setSelectHandler,
} from "../__mocks__/tauri-sql";

describe("invoice deletion", () => {
  beforeAll(async () => {
    // Warm the DB singleton so ensureSchema noise doesn't pollute the SQL log
    await getDb();
  });

  beforeEach(() => {
    setSelectHandler(null);
    clearExecutedStatements();
  });

  describe("reference generation with gaps", () => {
    it("returns MAX+1, not COUNT+1, so gaps never cause reference reuse", async () => {
      const references = ["2026-001", "2026-003"];
      setSelectHandler((sql, params) => {
        if (sql.includes("MAX(CAST(SUBSTR")) {
          // Emulate SQLite: MAX(CAST(SUBSTR(reference, start) AS INTEGER))
          // over rows matching the LIKE prefix
          const start = params[0] as number;
          const prefix = (params[1] as string).slice(0, -1); // strip trailing %
          const nums = references
            .filter((r) => r.startsWith(prefix))
            .map((r) => parseInt(r.slice(start - 1), 10));
          return [{ max_num: nums.length > 0 ? Math.max(...nums) : null }];
        }
        return [];
      });
      // Gapped sequence 2026-001, 2026-003 -> next must be 2026-004
      // (COUNT-based logic would wrongly return 2026-003 again)
      expect(await getNextInvoiceReference(2026)).toBe("2026-004");
      // Empty year -> starts at 001
      references.length = 0;
      expect(await getNextInvoiceReference(2026)).toBe("2026-001");
    });
  });

  describe("deleteInvoice", () => {
    it("rejects an invoice with a real reference (sent)", async () => {
      setSelectHandler((sql) => {
        if (sql.includes("FROM invoices WHERE id")) {
          return [{ id: 7, reference: "2026-002", status: "sent" }];
        }
        return [];
      });
      await expect(deleteInvoice(7)).rejects.toThrow(/draft/i);
      expect(
        executedStatements.filter((s) => s.sql.includes("DELETE FROM invoices"))
      ).toHaveLength(0);
    });

    it("rejects a cancelled invoice that previously had a real reference", async () => {
      setSelectHandler((sql) => {
        if (sql.includes("FROM invoices WHERE id")) {
          return [{ id: 8, reference: "2026-005", status: "cancelled" }];
        }
        return [];
      });
      await expect(deleteInvoice(8)).rejects.toThrow(/draft/i);
      expect(
        executedStatements.filter((s) => s.sql.includes("DELETE FROM invoices"))
      ).toHaveLength(0);
    });

    it("deletes a draft and never renumbers other invoices", async () => {
      setSelectHandler((sql) => {
        if (sql.includes("FROM invoices WHERE id")) {
          return [{ id: 3, reference: "DRAFT-1730000000000", status: "draft" }];
        }
        // If a reindex query sneaks back in, feed it gapped rows so any
        // renumbering would surface as an UPDATE below
        if (sql.includes("FROM invoices WHERE reference LIKE")) {
          return [
            { id: 1, reference: "2026-001" },
            { id: 2, reference: "2026-003" },
          ];
        }
        return [];
      });
      await deleteInvoice(3);
      expect(
        executedStatements.some((s) => s.sql.includes("DELETE FROM invoices"))
      ).toBe(true);
      // The conversion back-reference is cleared (FK enforcement) ...
      expect(
        executedStatements.some((s) =>
          s.sql.includes("UPDATE quotes SET converted_to_invoice_id = NULL")
        )
      ).toBe(true);
      // ... but invoices are never updated, and no UPDATE touches a
      // reference column (no renumbering)
      expect(
        executedStatements.some((s) => /UPDATE invoices/i.test(s.sql))
      ).toBe(false);
      expect(
        executedStatements.some(
          (s) => /^\s*UPDATE/i.test(s.sql) && /\breference\b/i.test(s.sql)
        )
      ).toBe(false);
    });

    it("allows deleting a cancelled invoice that still has a DRAFT reference", async () => {
      setSelectHandler((sql) => {
        if (sql.includes("FROM invoices WHERE id")) {
          return [{ id: 4, reference: "DRAFT-1730000000001", status: "cancelled" }];
        }
        return [];
      });
      await deleteInvoice(4);
      expect(
        executedStatements.some((s) => s.sql.includes("DELETE FROM invoices"))
      ).toBe(true);
    });
  });

  describe("createInvoiceWithLineItems", () => {
    it("persists template_id in the INSERT (column and bound param)", async () => {
      await createInvoiceWithLineItems(
        {
          reference: "DRAFT-00000000-0000-4000-8000-000000000000",
          client_id: "client-1",
          project_id: null,
          status: "draft",
          language: "EN",
          activity: "",
          activity_id: null,
          assignment: "",
          invoice_date: "2026-01-31",
          due_date: "2026-03-02",
          payment_terms_days: 30,
          subtotal: 100,
          discount_applied: 0,
          discount_rate: 0,
          discount_label: "",
          total: 100,
          paid_date: null,
          contact_id: null,
          billing_address_id: null,
          currency: "CHF",
          exchange_rate: 1,
          chf_equivalent: 100,
          po_number: null,
          pdf_path: null,
          from_quote_id: null,
          notes: "",
          reminder_count: 0,
          last_reminder_date: null,
          template_id: 5,
        },
        []
      );
      const insert = executedStatements.find((s) =>
        s.sql.includes("INSERT INTO invoices")
      );
      expect(insert).toBeDefined();
      // template_id was silently dropped before: assert the column is in the
      // statement and its value is bound as the 27th param
      expect(insert!.sql).toContain("template_id");
      expect(insert!.params).toHaveLength(27);
      expect(insert!.params[26]).toBe(5);
    });
  });

  describe("deleteQuote", () => {
    it("never renumbers remaining quotes", async () => {
      setSelectHandler((sql) => {
        if (sql.includes("FROM quotes WHERE id")) {
          return [{ id: 1, reference: "D-2026-001", status: "sent" }];
        }
        if (sql.includes("FROM quotes WHERE reference LIKE")) {
          return [{ id: 2, reference: "D-2026-003" }];
        }
        return [];
      });
      await deleteQuote(1);
      // Batched statements are logged via the execute_batch mock, so the
      // assertions below genuinely observe the delete's SQL
      expect(
        executedStatements.some((s) => s.sql.includes("DELETE FROM quotes"))
      ).toBe(true);
      // The conversion back-reference is cleared (FK enforcement) ...
      expect(
        executedStatements.some((s) =>
          s.sql.includes("UPDATE invoices SET from_quote_id = NULL")
        )
      ).toBe(true);
      // ... but quotes are never updated, and no UPDATE touches a
      // reference column (no renumbering)
      expect(
        executedStatements.some((s) => /UPDATE quotes/i.test(s.sql))
      ).toBe(false);
      expect(
        executedStatements.some(
          (s) => /^\s*UPDATE/i.test(s.sql) && /\breference\b/i.test(s.sql)
        )
      ).toBe(false);
    });
  });

  describe("deleteClient", () => {
    it("clears quote conversion back-references before deleting invoices (circular-FK break)", async () => {
      await deleteClient("client-1");
      const clearIdx = executedStatements.findIndex((s) =>
        s.sql.includes("UPDATE quotes SET converted_to_invoice_id = NULL")
      );
      const deleteIdx = executedStatements.findIndex((s) =>
        s.sql.includes("DELETE FROM invoices WHERE client_id")
      );
      expect(clearIdx).toBeGreaterThanOrEqual(0);
      expect(deleteIdx).toBeGreaterThanOrEqual(0);
      expect(clearIdx).toBeLessThan(deleteIdx);
    });
  });
});
