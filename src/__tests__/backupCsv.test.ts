import { describe, it, expect } from "vitest";
import {
  serializeCsv,
  parseCsv,
  applyNotNullDefaults,
  assertRestorableData,
  RestoreError,
  TABLES,
  type TableColumnInfo,
} from "../lib/backup";

describe("assertRestorableData", () => {
  it("throws RestoreError(backup_empty) when the backup has no CSVs at all", () => {
    expect(() => assertRestorableData([])).toThrowError(RestoreError);
    try {
      assertRestorableData([]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RestoreError);
      expect((e as RestoreError).code).toBe("backup_empty");
    }
  });

  it("throws when every CSV is header-only (no data rows)", () => {
    // parseCsv of a header-only file yields rows: [] — an interrupted backup
    // can leave such an empty-but-valid-looking folder
    expect(() =>
      assertRestorableData([
        { rows: parseCsv("id,name").rows },
        { rows: parseCsv("").rows },
      ])
    ).toThrowError(RestoreError);
  });

  it("passes when at least one table has a data row", () => {
    expect(() =>
      assertRestorableData([
        { rows: [] },
        { rows: parseCsv("id,name\n1,Acme").rows },
      ])
    ).not.toThrow();
  });
});

describe("TABLES", () => {
  // Single source of truth for backup export AND restore insert order
  // (parents before children); restore deletes iterate the reversed list.
  const EXPECTED_ORDER = [
    // Root tables (no FK dependencies)
    "business_profile",
    "expense_categories",
    "clients",
    "invoice_templates",
    "workload_templates",
    "income",
    "resources",
    "saved_filters",
    "dashboard_presets",
    "wiki_folders",
    "custom_lists",
    "notifications",
    // Children of clients
    "client_contacts",
    "client_addresses",
    "projects",
    // Children of projects
    "tasks",
    "project_tables",
    "resource_projects",
    // Children of tasks
    "subtasks",
    "time_entries",
    "workload_rows",
    // Invoicing (invoices <-> quotes reference each other; restored under
    // deferred FK checks)
    "invoices",
    "invoice_line_items",
    "quotes",
    "quote_line_items",
    "recurring_invoice_templates",
    // Remaining children
    "expenses",
    "resource_tags",
    "project_table_rows",
    "wiki_articles",
    "wiki_article_tags",
    "custom_list_items",
  ];

  it("pins the full table list in parent-first restore order", () => {
    expect(TABLES).toEqual(EXPECTED_ORDER);
  });

  it("includes every user-data table", () => {
    const required = [
      // Original 13
      "business_profile",
      "clients",
      "client_contacts",
      "projects",
      "tasks",
      "subtasks",
      "invoices",
      "invoice_line_items",
      "quotes",
      "quote_line_items",
      "expense_categories",
      "expenses",
      "notifications",
      // Previously missing from backups
      "income",
      "time_entries",
      "client_addresses",
      "recurring_invoice_templates",
      "invoice_templates",
      "resources",
      "resource_projects",
      "resource_tags",
      "custom_lists",
      "custom_list_items",
      "project_tables",
      "project_table_rows",
      "saved_filters",
      "wiki_folders",
      "wiki_articles",
      "wiki_article_tags",
      "dashboard_presets",
      "workload_templates",
    ];
    for (const table of required) {
      expect(TABLES, `missing table: ${table}`).toContain(table);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(TABLES).size).toBe(TABLES.length);
  });

  it("orders every FK parent before its child", () => {
    // Every REFERENCES edge in the schema (migrations + ensureSchema),
    // except the circular invoices.from_quote_id <-> quotes.converted_to_invoice_id
    // pair, which no linear order can satisfy (handled by deferred FK checks).
    const edges: [parent: string, child: string][] = [
      ["clients", "client_contacts"],
      ["clients", "client_addresses"],
      ["clients", "projects"],
      ["clients", "invoices"],
      ["clients", "quotes"],
      ["clients", "recurring_invoice_templates"],
      ["projects", "tasks"],
      ["projects", "invoices"],
      ["projects", "quotes"],
      ["projects", "time_entries"],
      ["projects", "resource_projects"],
      ["projects", "project_tables"],
      ["projects", "workload_rows"],
      ["tasks", "subtasks"],
      ["tasks", "time_entries"],
      ["tasks", "workload_rows"],
      ["workload_templates", "workload_rows"],
      ["client_contacts", "invoices"],
      ["invoice_templates", "invoices"],
      ["invoice_templates", "quotes"],
      ["invoices", "invoice_line_items"],
      ["invoices", "recurring_invoice_templates"],
      ["quotes", "quote_line_items"],
      ["expense_categories", "expenses"],
      ["resources", "resource_tags"],
      ["resources", "resource_projects"],
      ["project_tables", "project_table_rows"],
      ["wiki_folders", "wiki_articles"],
      ["wiki_articles", "wiki_article_tags"],
      ["custom_lists", "custom_list_items"],
    ];
    for (const [parent, child] of edges) {
      const pi = TABLES.indexOf(parent);
      const ci = TABLES.indexOf(child);
      expect(pi, `parent missing: ${parent}`).toBeGreaterThanOrEqual(0);
      expect(ci, `child missing: ${child}`).toBeGreaterThanOrEqual(0);
      expect(pi, `${parent} must precede ${child}`).toBeLessThan(ci);
    }
  });
});

describe("serializeCsv", () => {
  it("serializes plain values with a header row", () => {
    const csv = serializeCsv([{ id: 1, name: "Acme" }], ["id", "name"]);
    expect(csv).toBe("id,name\n1,Acme");
  });

  it("quotes values containing commas", () => {
    const csv = serializeCsv([{ name: "Acme, Inc." }], ["name"]);
    expect(csv).toBe('name\n"Acme, Inc."');
  });

  it("escapes double quotes by doubling them", () => {
    const csv = serializeCsv([{ note: 'say "hi"' }], ["note"]);
    expect(csv).toBe('note\n"say ""hi"""');
  });

  it("quotes values containing newlines", () => {
    const csv = serializeCsv([{ note: "line1\nline2" }], ["note"]);
    expect(csv).toBe('note\n"line1\nline2"');
  });

  it("serializes null as an unquoted empty field", () => {
    const csv = serializeCsv([{ a: null, b: "x" }], ["a", "b"]);
    expect(csv).toBe("a,b\n,x");
  });

  it("serializes an empty string as a quoted empty field", () => {
    const csv = serializeCsv([{ a: "", b: "x" }], ["a", "b"]);
    expect(csv).toBe('a,b\n"",x');
  });

  it("serializes numbers and booleans via String()", () => {
    const csv = serializeCsv([{ a: 3.5, b: 0, c: true }], ["a", "b", "c"]);
    expect(csv).toBe("a,b,c\n3.5,0,true");
  });
});

describe("parseCsv", () => {
  it("parses plain rows", () => {
    const { columns, rows } = parseCsv("id,name\n1,Acme\n2,Beta");
    expect(columns).toEqual(["id", "name"]);
    expect(rows).toEqual([
      ["1", "Acme"],
      ["2", "Beta"],
    ]);
  });

  it("parses quoted fields containing newlines as a single row", () => {
    const { rows } = parseCsv('id,note\n1,"line1\nline2"\n2,ok');
    expect(rows).toEqual([
      ["1", "line1\nline2"],
      ["2", "ok"],
    ]);
  });

  it("parses escaped double quotes", () => {
    const { rows } = parseCsv('note\n"say ""hi"""');
    expect(rows).toEqual([['say "hi"']]);
  });

  it("parses quoted fields containing commas", () => {
    const { rows } = parseCsv('name\n"Acme, Inc."');
    expect(rows).toEqual([["Acme, Inc."]]);
  });

  it("parses an unquoted empty field as null", () => {
    const { rows } = parseCsv("a,b\n,x");
    expect(rows).toEqual([[null, "x"]]);
  });

  it("parses a quoted empty field as an empty string", () => {
    const { rows } = parseCsv('a,b\n"",x');
    expect(rows).toEqual([["", "x"]]);
  });

  it("accepts CRLF line endings", () => {
    const { columns, rows } = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(columns).toEqual(["a", "b"]);
    expect(rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("ignores a trailing newline", () => {
    const { rows } = parseCsv("a\n1\n");
    expect(rows).toEqual([["1"]]);
  });

  it("parses a trailing unquoted empty field at end of input as null", () => {
    const { rows } = parseCsv("a,b\n1,");
    expect(rows).toEqual([["1", null]]);
  });

  it("returns no rows for header-only input", () => {
    const { columns, rows } = parseCsv("a,b");
    expect(columns).toEqual(["a", "b"]);
    expect(rows).toEqual([]);
  });

  it("ignores a trailing CRLF terminator", () => {
    const { rows } = parseCsv("a\r\n1\r\n");
    expect(rows).toEqual([["1"]]);
  });

  it("returns no rows for an empty string", () => {
    const { columns, rows } = parseCsv("");
    expect(columns).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("preserves unicode content", () => {
    const { rows } = parseCsv("a\nZürich – été 你好");
    expect(rows).toEqual([["Zürich – été 你好"]]);
  });
});

describe("round trip", () => {
  it("survives serialize then parse over 3 rows x 5 columns", () => {
    const columns = ["id", "name", "notes", "amount", "archived"];
    const input = [
      {
        id: 1,
        name: "Acme, Inc.",
        notes: "first line\nsecond line",
        amount: 1250.5,
        archived: null,
      },
      {
        id: 2,
        name: 'The "Best" Client',
        notes: "",
        amount: 0,
        archived: 1,
      },
      {
        id: 3,
        name: "Zürich – été 你好",
        notes: null,
        amount: null,
        archived: 0,
      },
    ];

    const csv = serializeCsv(input, columns);
    const parsed = parseCsv(csv);

    expect(parsed.columns).toEqual(columns);
    // Non-null values come back as strings; null comes back as null
    expect(parsed.rows).toEqual([
      ["1", "Acme, Inc.", "first line\nsecond line", "1250.5", null],
      ["2", 'The "Best" Client', "", "0", "1"],
      ["3", "Zürich – été 你好", null, null, "0"],
    ]);
  });

  it("survives parse then serialize back to the same string", () => {
    const csv = 'a,b,c\n1,"has\nnewline",\n"",plain,"q""q"';
    const { columns, rows } = parseCsv(csv);
    const objects = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
    expect(serializeCsv(objects, columns)).toBe(csv);
  });
});

describe("applyNotNullDefaults", () => {
  const info = (
    name: string,
    notnull: number,
    dflt_value: string | null,
    type: string
  ): TableColumnInfo => ({ name, notnull, dflt_value, type });

  it("keeps null for a nullable column and empty string for a quoted-empty field", () => {
    // Parsed row from CSV `"",` — quoted empty then unquoted empty
    const { values, substitutions } = applyNotNullDefaults(
      ["", null],
      ["a", "b"],
      [info("a", 0, null, "TEXT"), info("b", 0, null, "TEXT")]
    );
    expect(values).toEqual(["", null]);
    expect(substitutions).toBe(0);
  });

  it("substitutes '' for a NOT NULL TEXT column with dflt_value ''", () => {
    const { values, substitutions } = applyNotNullDefaults(
      [null],
      ["first_name"],
      [info("first_name", 1, "''", "TEXT")]
    );
    expect(values).toEqual([""]);
    expect(substitutions).toBe(1);
  });

  it("substitutes the unquoted literal for a NOT NULL column with a quoted-string default", () => {
    const { values } = applyNotNullDefaults(
      [null],
      ["status"],
      [info("status", 1, "'draft'", "TEXT")]
    );
    expect(values).toEqual(["draft"]);
  });

  it("substitutes 0 for a NOT NULL INTEGER column with dflt_value 0", () => {
    const { values } = applyNotNullDefaults(
      [null],
      ["archived"],
      [info("archived", 1, "0", "INTEGER")]
    );
    expect(values).toEqual([0]);
  });

  it("falls back to '' by TEXT affinity for a non-literal default expression", () => {
    const { values } = applyNotNullDefaults(
      [null],
      ["created_at"],
      [info("created_at", 1, "(datetime('now'))", "TEXT")]
    );
    expect(values).toEqual([""]);
  });

  it("falls back to 0 by affinity for a NOT NULL REAL column with no default", () => {
    const { values } = applyNotNullDefaults(
      [null],
      ["amount"],
      [info("amount", 1, null, "REAL")]
    );
    expect(values).toEqual([0]);
  });

  it("leaves a quoted-empty field untouched on a NOT NULL column", () => {
    const { values, substitutions } = applyNotNullDefaults(
      [""],
      ["first_name"],
      [info("first_name", 1, "''", "TEXT")]
    );
    expect(values).toEqual([""]);
    expect(substitutions).toBe(0);
  });

  it("counts one substitution per defaulted value across a row", () => {
    const { values, substitutions } = applyNotNullDefaults(
      ["1", null, null, null],
      ["id", "first_name", "archived", "notes"],
      [
        info("id", 1, null, "INTEGER"),
        info("first_name", 1, "''", "TEXT"),
        info("archived", 1, "0", "INTEGER"),
        info("notes", 0, null, "TEXT"),
      ]
    );
    expect(values).toEqual(["1", "", 0, null]);
    expect(substitutions).toBe(2);
  });

  it("treats a row shorter than the column list as trailing nulls", () => {
    const { values, substitutions } = applyNotNullDefaults(
      ["1"],
      ["id", "first_name"],
      [info("id", 1, null, "INTEGER"), info("first_name", 1, "''", "TEXT")]
    );
    expect(values).toEqual(["1", ""]);
    expect(substitutions).toBe(1);
  });

  it("keeps null for a column missing from table info", () => {
    const { values, substitutions } = applyNotNullDefaults(
      [null],
      ["legacy_col"],
      [info("id", 1, null, "INTEGER")]
    );
    expect(values).toEqual([null]);
    expect(substitutions).toBe(0);
  });

  it("substitutes the numeric value for a decimal literal default", () => {
    const { values } = applyNotNullDefaults(
      [null],
      ["discount_rate"],
      [info("discount_rate", 1, "0.0", "REAL")]
    );
    expect(values).toEqual([0.0]);
  });

  it("unescapes doubled quotes in a string literal default", () => {
    const { values } = applyNotNullDefaults(
      [null],
      ["label"],
      [info("label", 1, "'it''s'", "TEXT")]
    );
    expect(values).toEqual(["it's"]);
  });

  it("accepts a prebuilt Map of column info", () => {
    const map = new Map([["first_name", info("first_name", 1, "''", "TEXT")]]);
    const { values, substitutions } = applyNotNullDefaults(
      [null],
      ["first_name"],
      map
    );
    expect(values).toEqual([""]);
    expect(substitutions).toBe(1);
  });
});
