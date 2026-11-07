/**
 * Notifications in the current UI language. A notice the app writes keeps the
 * label keys of its title and message and the values that fill them
 * (migration 015), so the list translates it when shown; a row without keys
 * (written before 015, or an error notice holding the raw error) shows its
 * saved text.
 */
import { uiLabels, type AppLanguage, type UIKey } from "../i18n/ui";
import type { AppNotification } from "../types/notification";

/** A value that fills `{name}` in a label: text, a number, or another label. */
export type NoticeParam = string | number | { label: UIKey };
export type NoticeParams = Record<string, NoticeParam>;

/** What a notice stores next to its text. */
export interface NoticeKeys {
  title_key: UIKey | null;
  message_key: UIKey | null;
  /** JSON of the NoticeParams, or null. */
  params: string | null;
}

type Labels = Record<UIKey, string>;

function paramText(v: NoticeParam | undefined, labels: Labels): string {
  if (v == null) return "";
  if (typeof v === "object") return labels[v.label] ?? "";
  return String(v);
}

/** Fill `{name}` placeholders from the params. */
export function fillLabel(tpl: string, params: NoticeParams, labels: Labels): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => paramText(params[k], labels));
}

/**
 * Title and message for a new notice in `lang` (to save as its text and show
 * as a toast or banner), with the keys that let the list translate it later.
 * Pass `message` instead of a `messageKey` for text that has no label (a file name).
 */
export function buildNotice(
  lang: AppLanguage,
  titleKey: UIKey,
  opts: { messageKey?: UIKey; message?: string; params?: NoticeParams } = {}
): { title: string; message: string } & NoticeKeys {
  const labels = uiLabels[lang] as Labels;
  const params = opts.params ?? {};
  return {
    title: fillLabel(labels[titleKey], params, labels),
    message: opts.messageKey ? fillLabel(labels[opts.messageKey], params, labels) : (opts.message ?? ""),
    ...noticeKeys(titleKey, opts.messageKey, params),
  };
}

/**
 * The keys alone, for a writer that already has its text:
 *   createNotification({ ...text, ...noticeKeys("auto_backup_title") })
 */
export function noticeKeys(titleKey: UIKey, messageKey?: UIKey | null, params?: NoticeParams): NoticeKeys {
  return {
    title_key: titleKey,
    message_key: messageKey ?? null,
    params: params && Object.keys(params).length > 0 ? JSON.stringify(params) : null,
  };
}

function parseParams(raw: string | null | undefined): NoticeParams | null {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as NoticeParams) : null;
  } catch {
    return null;
  }
}

/**
 * The title and message to show for a saved notification in `lang`. Each part
 * whose key is missing or unknown (a label renamed since) shows its saved text.
 */
export function notificationText(
  n: Pick<AppNotification, "title" | "message" | "title_key" | "message_key" | "params">,
  lang: AppLanguage
): { title: string; message: string } {
  const labels = uiLabels[lang] as Labels;
  const params = parseParams(n.params);
  const part = (key: string | null | undefined, saved: string) => {
    if (!key || params == null || !(key in labels)) return saved;
    return fillLabel(labels[key as UIKey], params, labels);
  };
  return { title: part(n.title_key, n.title), message: part(n.message_key, n.message) };
}
