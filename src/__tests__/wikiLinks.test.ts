import { describe, it, expect } from "vitest";
import { isAllowedWikiLink } from "../lib/wikiLinks";

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
