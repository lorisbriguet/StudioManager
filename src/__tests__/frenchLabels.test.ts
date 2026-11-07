import { describe, it, expect } from "vitest";
import { shortMonthNames } from "../lib/monthNames";
import { machineKindLabel } from "../lib/upkeep/templates";
import { buildNotice, notificationText, noticeKeys } from "../lib/notificationText";
import { uiLabels } from "../i18n/ui";

describe("shortMonthNames", () => {
  it("gives twelve months in the app language", () => {
    const en = shortMonthNames("EN");
    const fr = shortMonthNames("FR");
    expect(en).toHaveLength(12);
    expect(fr).toHaveLength(12);
    expect(en[0]).toBe("Jan");
    expect(en[11]).toBe("Dec");
    expect(fr[0]).toMatch(/^janv/);
    expect(fr[7]).toMatch(/^août/);
  });
});

describe("machineKindLabel", () => {
  it("shows a template key as the template name in either language", () => {
    expect(machineKindLabel("printer_3d", "EN")).toBe(uiLabels.EN.tpl_printer_3d);
    expect(machineKindLabel("printer_3d", "FR")).toBe(uiLabels.FR.tpl_printer_3d);
    expect(machineKindLabel("monitor", "FR")).toBe(uiLabels.FR.tpl_monitor);
    expect(machineKindLabel("camera", "EN")).toBe(uiLabels.EN.tpl_camera);
  });

  it("translates a template name saved in the other language", () => {
    expect(machineKindLabel(uiLabels.EN.tpl_monitor, "FR")).toBe(uiLabels.FR.tpl_monitor);
    expect(machineKindLabel(uiLabels.FR.tpl_camera, "EN")).toBe(uiLabels.EN.tpl_camera);
  });

  it("keeps any other text as saved", () => {
    expect(machineKindLabel("Risograph", "FR")).toBe("Risograph");
    expect(machineKindLabel("", "EN")).toBe("");
    expect(machineKindLabel(null, "EN")).toBe("");
  });
});

describe("notificationText", () => {
  it("shows a keyed notice in the current language, whatever it was written in", () => {
    const written = buildNotice("EN", "notice_disk_title", {
      messageKey: "notice_disk_msg",
      params: { slot: 2, machine: "NAS", health: { label: "notice_health_failing" } },
    });
    expect(written.title).toBe(uiLabels.EN.notice_disk_title);
    expect(written.message).toContain(uiLabels.EN.notice_health_failing);

    const fr = notificationText(written, "FR");
    expect(fr.title).toBe(uiLabels.FR.notice_disk_title);
    expect(fr.message).toContain(uiLabels.FR.notice_health_failing);
    expect(fr.message).toContain("NAS");
    expect(fr.message).not.toMatch(/\{\w+\}/);
  });

  it("keeps a free-text message next to a keyed title", () => {
    const n = { title: uiLabels.EN.auto_backup_title, message: "backup-2026.db", ...noticeKeys("auto_backup_title") };
    expect(notificationText(n, "FR")).toEqual({ title: uiLabels.FR.auto_backup_title, message: "backup-2026.db" });
  });

  it("shows the saved text for rows without keys, unknown keys or broken params", () => {
    const old = { title: "Invoice overdue", message: "INV-1", title_key: null, message_key: null, params: null };
    expect(notificationText(old, "FR")).toEqual({ title: "Invoice overdue", message: "INV-1" });
    const renamed = { ...old, title_key: "no_such_label" };
    expect(notificationText(renamed, "FR").title).toBe("Invoice overdue");
    const broken = { ...old, title_key: "auto_backup_title", params: "{not json" };
    expect(notificationText(broken, "FR").title).toBe("Invoice overdue");
  });

  it("fills counts", () => {
    const n = { title: "x", message: "y", ...noticeKeys("overdue_marked_other", null, { count: 3 }) };
    expect(notificationText(n, "FR").title).toBe(uiLabels.FR.overdue_marked_other.replace("{count}", "3"));
  });
});

describe("unread label", () => {
  it("has a singular and a plural in French", () => {
    expect(uiLabels.FR.unread_one).toBe("{count} non lu");
    expect(uiLabels.FR.unread_other).toBe("{count} non lus");
  });
});
