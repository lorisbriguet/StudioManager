import { describe, it, expect, afterEach } from "vitest";
import { plural } from "../i18n/plural";
import { uiLabels } from "../i18n/ui";
import { useAppStore } from "../stores/app-store";

afterEach(() => useAppStore.setState({ language: "EN" }));

describe("plural follows the UI language", () => {
  it("English: only 1 is singular", () => {
    const t = uiLabels.EN;
    expect(plural(0, t.task_count_one, t.task_count_other)).toBe("0 tasks");
    expect(plural(1, t.task_count_one, t.task_count_other)).toBe("1 task");
    expect(plural(2, t.task_count_one, t.task_count_other)).toBe("2 tasks");
  });

  it("French: 0 and 1 are singular", () => {
    useAppStore.setState({ language: "FR" });
    const t = uiLabels.FR;
    expect(plural(0, t.task_count_one, t.task_count_other)).toBe("0 tâche");
    expect(plural(1, t.task_count_one, t.task_count_other)).toBe("1 tâche");
    expect(plural(2, t.task_count_one, t.task_count_other)).toBe("2 tâches");
    expect(plural(0, t.bulk_deleted_tasks_one, t.bulk_deleted_tasks_other)).toBe("0 tâche supprimée");
  });

  it("no French one-form hard-codes the count", () => {
    for (const [key, value] of Object.entries(uiLabels.FR)) {
      if (/_one$/.test(key) && /(^|\\s)1\\s/.test(value)) throw new Error(`${key}: "${value}" should use {count}`);
    }
  });
});
