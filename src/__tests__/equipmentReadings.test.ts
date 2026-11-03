import { describe, it, expect, vi, beforeEach } from "vitest";

const select = vi.fn();
vi.mock("../db", () => ({
  getEquipmentDb: async () => ({ select }),
  getDb: async () => {
    throw new Error("own database must not be used");
  },
  validateFields: vi.fn(),
  TransactionBatch: class {},
}));

import { getMachineDisks, getLatestMetrics, getEquipmentConnections } from "../db/queries/connections";

beforeEach(() => select.mockReset());

describe("equipment readings", () => {
  it("getMachineDisks reads the equipment database", async () => {
    select.mockResolvedValue([{ slot: "1" }]);
    expect(await getMachineDisks(4)).toEqual([{ slot: "1" }]);
    expect(select.mock.calls[0][0]).toContain("machine_disks");
  });

  it("getEquipmentConnections reads the equipment database", async () => {
    select.mockResolvedValue([{ id: 1 }]);
    expect(await getEquipmentConnections()).toEqual([{ id: 1 }]);
    expect(select.mock.calls[0][0]).toContain("FROM connections");
  });

  it("getLatestMetrics returns one row per metric for the prefix", async () => {
    select.mockResolvedValue([
      { metric: "volume_used_bytes:volume_1", value: 9, read_at: "2026-11-02 10:00:00" },
      { metric: "volume_used_bytes:volume_1", value: 5, read_at: "2026-11-01 10:00:00" },
      { metric: "volume_used_bytes:volume_2", value: 3, read_at: "2026-11-01 10:00:00" },
    ]);
    const rows = await getLatestMetrics(4, "volume_used_bytes:");
    expect(rows.map((r) => [r.metric, r.value])).toEqual([
      ["volume_used_bytes:volume_1", 9],
      ["volume_used_bytes:volume_2", 3],
    ]);
  });

  it("getLatestMetrics escapes LIKE wildcards in the prefix", async () => {
    select.mockResolvedValue([]);
    await getLatestMetrics(4, "a_b%c\\");
    const [sql, params] = select.mock.calls[0];
    expect(sql).toMatch(/LIKE \$2 ESCAPE '\\'/);
    expect(params).toEqual([4, "a\\_b\\%c\\\\%"]);
  });
});
