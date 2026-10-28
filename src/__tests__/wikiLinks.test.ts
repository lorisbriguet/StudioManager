import { describe, it, expect } from "vitest";
import { isAllowedWikiLink, parseWikiArticleId } from "../lib/wikiLinks";

// Stored wiki content must never carry executable or local-file URLs.

describe("isAllowedWikiLink", () => {
  it("allows web URLs and internal wiki links", () => {
    expect(isAllowedWikiLink("https://example.com/page")).toBe(true);
    expect(isAllowedWikiLink("http://example.com")).toBe(true);
    expect(isAllowedWikiLink("/wiki?article=42")).toBe(true);
  });

  it("rejects script, data and file schemes", () => {
    expect(isAllowedWikiLink("javascript:alert(1)")).toBe(false);
    expect(isAllowedWikiLink(" javascript:alert(1)")).toBe(false);
    expect(isAllowedWikiLink("JAVASCRIPT:alert(1)")).toBe(false);
    expect(isAllowedWikiLink("data:text/html,<script>1</script>")).toBe(false);
    expect(isAllowedWikiLink("file:///etc/passwd")).toBe(false);
    expect(isAllowedWikiLink("vbscript:x")).toBe(false);
  });
});

describe("parseWikiArticleId", () => {
  it("reads the article id from internal wiki links", () => {
    expect(parseWikiArticleId("/wiki?article=42")).toBe(42);
    expect(parseWikiArticleId(" /wiki?article=7 ")).toBe(7);
    expect(parseWikiArticleId("/wiki?x=1&article=3")).toBe(3);
  });

  it("returns null for anything else", () => {
    expect(parseWikiArticleId("https://example.com/wiki?article=42")).toBeNull();
    expect(parseWikiArticleId("/wiki?article=")).toBeNull();
    expect(parseWikiArticleId("/wiki?article=abc")).toBeNull();
    expect(parseWikiArticleId("/wiki?article=0")).toBeNull();
    expect(parseWikiArticleId("/wiki?article=4x")).toBeNull();
  });
});
