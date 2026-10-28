/**
 * Allowlist for hrefs stored in wiki rich text: web URLs and internal
 * /wiki links only. Everything else (javascript:, data:, file:, …) is
 * rejected before it can be persisted.
 */
export function isAllowedWikiLink(url: string): boolean {
  return /^(https?:\/\/|\/wiki\?)/i.test(url.trim());
}

/**
 * Returns the article id of an internal wiki link (`/wiki?article=42`),
 * or null for anything else.
 */
export function parseWikiArticleId(href: string): number | null {
  const match = /^\/wiki\?(?:.*&)?article=(\d+)(?:&|#|$)/.exec(href.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A link to a project's Markdown file: `/wiki?file=<projectId>:<path>`. */
export function wikiFileHref(projectId: number, rel: string): string {
  return `/wiki?file=${projectId}:${rel.split("/").map(encodeURIComponent).join("/")}`;
}

/** The tab/link key (`file:<projectId>:<path>`) of a file link, or null. */
export function parseWikiFileKey(href: string): string | null {
  const match = /^\/wiki\?(?:.*&)?file=(\d+):([^&#]+)/.exec(href.trim());
  if (!match) return null;
  try {
    const rel = decodeURIComponent(match[2]);
    if (!rel || rel.split("/").some((part) => part === ".." || part === "")) return null;
    return `file:${match[1]}:${rel}`;
  } catch {
    return null;
  }
}
