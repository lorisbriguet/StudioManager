import { describe, it, expect } from "vitest";
import { TABLES } from "../lib/backup";

const UPKEEP_TABLES = [
  "connections",
  "machines",
  "machine_files",
  "machine_projects",
  "upkeep_items",
  "service_log",
  "consumables",
  "consumable_usage",
  "subscriptions",
  "subscription_renewals",
  "machine_readings",
  "machine_disks",
];

describe("backup TABLES: upkeep", () => {
  it("lists every upkeep table", () => {
    for (const t of UPKEEP_TABLES) expect(TABLES).toContain(t);
  });

  it.each([
    ["connections", "machines"],
    ["machines", "upkeep_items"],
    ["machines", "service_log"],
    ["machines", "machine_files"],
    ["machines", "machine_projects"],
    ["machines", "machine_readings"],
    ["machines", "machine_disks"],
    ["upkeep_items", "service_log"],
    ["consumables", "consumable_usage"],
    ["subscriptions", "subscription_renewals"],
    ["expenses", "machines"],
    ["projects", "machine_projects"],
  ])("%s comes before %s", (parent, child) => {
    expect(TABLES.indexOf(parent)).toBeGreaterThanOrEqual(0);
    expect(TABLES.indexOf(parent)).toBeLessThan(TABLES.indexOf(child));
  });
});
