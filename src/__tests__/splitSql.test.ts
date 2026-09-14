import { describe, it, expect } from "vitest";
import { splitSeedStatements } from "../db/seeds/splitSql";

describe("splitSeedStatements", () => {
  it("splits statements on semicolons and drops comment-only lines", () => {
    const sql = "-- header\nDELETE FROM a;\n\n-- note\nINSERT INTO b (x) VALUES (1);\n";
    expect(splitSeedStatements(sql)).toEqual(["DELETE FROM a", "INSERT INTO b (x) VALUES (1)"]);
  });

  it("ignores semicolons inside comment lines", () => {
    const sql = "-- kept; everything else is wiped\nDELETE FROM a;\n";
    expect(splitSeedStatements(sql)).toEqual(["DELETE FROM a"]);
  });

  it("ignores semicolons inside string literals", () => {
    const sql = "INSERT INTO b (x) VALUES ('one; two');\nINSERT INTO b (x) VALUES ('it''s; fine');";
    expect(splitSeedStatements(sql)).toEqual([
      "INSERT INTO b (x) VALUES ('one; two')",
      "INSERT INTO b (x) VALUES ('it''s; fine')",
    ]);
  });

  it("keeps multi-line statements intact", () => {
    const sql = "INSERT INTO b (x) VALUES\n  (1),\n  (2);";
    expect(splitSeedStatements(sql)).toEqual(["INSERT INTO b (x) VALUES\n  (1),\n  (2)"]);
  });
});
