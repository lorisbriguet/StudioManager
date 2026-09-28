import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createResource } from "../db/queries/resources";
import { getDb } from "../db";
import { executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";

describe("createResource", () => {
  beforeAll(async () => {
    await getDb();
  });

  beforeEach(() => {
    clearExecutedStatements();
  });

  it("batches multiple tags into a single INSERT INTO resource_tags statement", async () => {
    await createResource({
      name: "Figma",
      url: "https://figma.com",
      price: "0",
      tags: ["design", "ui", "prototyping"],
    });

    const tagInserts = executedStatements.filter((s) =>
      s.sql.includes("INSERT INTO resource_tags")
    );
    expect(tagInserts).toHaveLength(1);
    expect(tagInserts[0].params).toEqual([1, "design", 1, "ui", 1, "prototyping"]);
  });

  it("drops empty and whitespace-only tags", async () => {
    await createResource({
      name: "Figma",
      url: "https://figma.com",
      price: "0",
      tags: ["design", "  ", ""],
    });

    const tagInserts = executedStatements.filter((s) =>
      s.sql.includes("INSERT INTO resource_tags")
    );
    expect(tagInserts).toHaveLength(1);
    expect(tagInserts[0].params).toEqual([1, "design"]);
  });

  it("issues no tag insert when all tags are empty", async () => {
    await createResource({
      name: "Figma",
      url: "https://figma.com",
      price: "0",
      tags: ["", "   "],
    });

    const tagInserts = executedStatements.filter((s) =>
      s.sql.includes("INSERT INTO resource_tags")
    );
    expect(tagInserts).toHaveLength(0);
  });
});
