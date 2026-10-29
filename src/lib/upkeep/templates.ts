import { Image, Laptop, Monitor, Printer, Wrench, type LucideIcon } from "lucide-react";
import { ICONS } from "../../components/ui/icons";
import type { UIKey } from "../../i18n/ui";
import type { IntervalUnit } from "../../types/upkeep";

export type MachineTemplateKey =
  | "nas" | "printer_3d" | "printer_photo" | "monitor" | "camera" | "computer" | "generic";

export interface MachineTemplateItem {
  /** i18n key of the starting title; the saved item stores the translated text. */
  titleKey: UIKey;
  schedule: "interval" | "usage";
  interval_n?: number;
  interval_unit?: IntervalUnit;
  usage_every?: number;
}

export interface MachineTemplate {
  key: MachineTemplateKey;
  nameKey: UIKey;
  icon: LucideIcon;
  items: MachineTemplateItem[];
}

/** Starting points only: every interval is editable before and after saving. */
export const MACHINE_TEMPLATES: MachineTemplate[] = [
  {
    key: "nas", nameKey: "tpl_nas", icon: ICONS.disk,
    items: [
      { titleKey: "tpl_nas_restore", schedule: "interval", interval_n: 3, interval_unit: "month" },
      { titleKey: "tpl_nas_update", schedule: "interval", interval_n: 1, interval_unit: "month" },
      { titleKey: "tpl_nas_logs", schedule: "interval", interval_n: 1, interval_unit: "month" },
      { titleKey: "tpl_nas_fans", schedule: "interval", interval_n: 6, interval_unit: "month" },
    ],
  },
  {
    key: "printer_3d", nameKey: "tpl_printer_3d", icon: Printer,
    items: [
      { titleKey: "tpl_p3d_nozzle", schedule: "usage", usage_every: 200 },
      { titleKey: "tpl_p3d_plate", schedule: "usage", usage_every: 50 },
      { titleKey: "tpl_p3d_belts", schedule: "interval", interval_n: 6, interval_unit: "month" },
    ],
  },
  {
    key: "printer_photo", nameKey: "tpl_printer_photo", icon: Image,
    items: [
      { titleKey: "tpl_photo_nozzle", schedule: "interval", interval_n: 1, interval_unit: "month" },
      { titleKey: "tpl_photo_clean", schedule: "interval", interval_n: 3, interval_unit: "month" },
      { titleKey: "tpl_photo_rollers", schedule: "interval", interval_n: 6, interval_unit: "month" },
    ],
  },
  {
    key: "monitor", nameKey: "tpl_monitor", icon: Monitor,
    items: [
      { titleKey: "tpl_monitor_calibrate", schedule: "interval", interval_n: 3, interval_unit: "month" },
      { titleKey: "tpl_monitor_clean", schedule: "interval", interval_n: 1, interval_unit: "month" },
    ],
  },
  {
    key: "camera", nameKey: "tpl_camera", icon: ICONS.camera,
    items: [
      { titleKey: "tpl_camera_sensor", schedule: "interval", interval_n: 6, interval_unit: "month" },
      { titleKey: "tpl_camera_firmware", schedule: "interval", interval_n: 3, interval_unit: "month" },
    ],
  },
  {
    key: "computer", nameKey: "tpl_computer", icon: Laptop,
    items: [
      { titleKey: "tpl_computer_updates", schedule: "interval", interval_n: 1, interval_unit: "month" },
      { titleKey: "tpl_computer_restore", schedule: "interval", interval_n: 3, interval_unit: "month" },
      { titleKey: "tpl_computer_dust", schedule: "interval", interval_n: 1, interval_unit: "year" },
    ],
  },
  { key: "generic", nameKey: "tpl_generic", icon: Wrench, items: [] },
];

export function templateByKey(key: string | null | undefined): MachineTemplate | undefined {
  return MACHINE_TEMPLATES.find((t) => t.key === key);
}
