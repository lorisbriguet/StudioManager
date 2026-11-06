// The app's UI labels, in English and French. Each area's labels live in
// src/i18n/labels/<area>.ts; this file merges them. Add a label to the file
// of the page that shows it, in both EN and FR.

import { common } from "./labels/common";
import { feedback } from "./labels/feedback";
import { dashboard } from "./labels/dashboard";
import { work } from "./labels/work";
import { clients } from "./labels/clients";
import { finance } from "./labels/finance";
import { settings } from "./labels/settings";
import { wiki } from "./labels/wiki";
import { upkeep } from "./labels/upkeep";
import { agents } from "./labels/agents";

export type AppLanguage = "EN" | "FR";

const ui = {
  EN: {
    ...common.EN,
    ...feedback.EN,
    ...dashboard.EN,
    ...work.EN,
    ...clients.EN,
    ...finance.EN,
    ...settings.EN,
    ...wiki.EN,
    ...upkeep.EN,
    ...agents.EN,
  },
  FR: {
    ...common.FR,
    ...feedback.FR,
    ...dashboard.FR,
    ...work.FR,
    ...clients.FR,
    ...finance.FR,
    ...settings.FR,
    ...wiki.FR,
    ...upkeep.FR,
    ...agents.FR,
  },
} as const;

export type UIKey = keyof typeof ui.EN;
export const uiLabels = ui;
