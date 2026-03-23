import { describe, it, expect } from "vitest";
import { validateFields } from "../db/index";

describe("validateFields (SQL injection prevention)", () => {
  it("accepts valid field names", () => {
    expect(() => validateFields(["name", "total_amount", "clientId", "_private"])).not.toThrow();
  });

  it("rejects field names with SQL injection attempts", () => {
    expect(() => validateFields(["name; DROP TABLE"])).toThrow("Invalid field name");
    expect(() => validateFields(["1=1--"])).toThrow("Invalid field name");
    expect(() => validateFields(["name OR 1=1"])).toThrow("Invalid field name");
  });

  it("rejects field names with special characters", () => {
    expect(() => validateFields(["field-name"])).toThrow("Invalid field name");
    expect(() => validateFields(["field.name"])).toThrow("Invalid field name");
    expect(() => validateFields(["field name"])).toThrow("Invalid field name");
  });

  it("rejects field names starting with numbers", () => {
    expect(() => validateFields(["123field"])).toThrow("Invalid field name");
  });

  it("accepts empty array", () => {
    expect(() => validateFields([])).not.toThrow();
  });
});
