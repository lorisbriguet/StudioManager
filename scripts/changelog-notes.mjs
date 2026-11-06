#!/usr/bin/env node
// Prints the notes of one version from CHANGELOG.md (RELEASING.md, steps 5 to 7).
//
//   node scripts/changelog-notes.mjs <version> summary   one line, for latest.json "notes"
//   node scripts/changelog-notes.mjs <version> body      the release description
//
// A version's section starts at "## <version> (YYYY-MM-DD)" and ends at the next
// "## ". Its first paragraph is the summary the in-app updater shows; the rest
// is the body. Relative links in the body point at the repo files of the tag
// (vX.Y.Z), so they keep working on the GitHub release page.
// Exits 1, saying why, when the section or its summary is missing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "https://github.com/lorisbriguet/StudioManager";

export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  // Headings inside a ``` block (the format example) are not sections.
  let fenced = false;
  const isHeading = lines.map((l) => {
    if (l.startsWith("```")) fenced = !fenced;
    return !fenced && l.startsWith("## ");
  });
  const start = lines.findIndex((l, i) => isHeading[i] && l.split(/\s+/)[1] === version);
  if (start === -1) throw new Error(`CHANGELOG.md has no "## ${version} (YYYY-MM-DD)" section`);
  let end = lines.findIndex((_, i) => i > start && isHeading[i]);
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end);

  const first = section.findIndex((l) => l.trim() !== "");
  const after = first === -1 ? -1 : section.findIndex((l, i) => i > first && l.trim() === "");
  const para = first === -1 ? [] : section.slice(first, after === -1 ? section.length : after);
  if (para.length === 0 || /^(#|[-*] |\d+\. )/.test(para[0].trim())) {
    throw new Error(`the ${version} section of CHANGELOG.md must start with a one-line summary paragraph`);
  }
  const summary = para
    .map((l) => l.trim())
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

  const tag = `v${version}`;
  const body = section
    .join("\n")
    .trim()
    .replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (_, path) => `](${REPO}/blob/${tag}/${path})`);
  return { summary, body: body + "\n" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, part] = process.argv.slice(2);
  if (!version || (part !== "summary" && part !== "body")) {
    console.error("usage: node scripts/changelog-notes.mjs <version> summary|body");
    process.exit(2);
  }
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md");
  try {
    const s = changelogSection(readFileSync(file, "utf8"), version);
    process.stdout.write(part === "summary" ? s.summary + "\n" : s.body);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
