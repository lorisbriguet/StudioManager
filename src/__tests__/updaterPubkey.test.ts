// The updater pubkey in tauri.conf.json is what every installed app checks
// updates against (RELEASING.md, "Rotate the key"). A malformed one means no
// update can ever install, so check its shape when it is replaced.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const conf = JSON.parse(readFileSync(join(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));

describe("updater pubkey", () => {
  const b64: string = conf.plugins.updater.pubkey;

  it("is base64 of a minisign public key file", () => {
    expect(b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const [comment, keyLine] = Buffer.from(b64, "base64").toString("utf8").split("\n");
    expect(comment).toMatch(/^untrusted comment: minisign public key: [0-9A-F]{16}$/);
    const key = Buffer.from(keyLine, "base64");
    // "Ed" + key id (8 bytes) + Ed25519 key (32 bytes)
    expect(key.length).toBe(42);
    expect(key.subarray(0, 2).toString("latin1")).toBe("Ed");
    // The key id in the comment is the key id bytes, reversed (little-endian).
    const id = Buffer.from(key.subarray(2, 10)).reverse().toString("hex").toUpperCase();
    expect(comment.endsWith(id)).toBe(true);
  });
});
