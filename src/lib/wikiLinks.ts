/**
 * Allowlist for hrefs stored in wiki rich text: web URLs and internal
 * /wiki links only. Everything else (javascript:, data:, file:, …) is
 * rejected before it can be persisted.
 */
export function isAllowedWikiLink(url: string): boolean {
  return /^(https?:\/\/|\/wiki\?)/i.test(url.trim());
}
