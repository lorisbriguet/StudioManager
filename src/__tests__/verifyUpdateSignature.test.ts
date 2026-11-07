// scripts/verify-update-signature.mjs checks an update's .sig the way installed
// apps do (RELEASING.md, step 4 and "Rotate the key"). Signatures here are made
// with a throwaway Ed25519 key in the minisign format Tauri writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keyId, verifySignature } from "../../scripts/verify-update-signature.mjs";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function throwawayKey(id: Buffer) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  const keyLine = Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64");
  const pubkeyB64 = b64(`untrusted comment: minisign public key: ${keyId(id)}\n${keyLine}\n`);
  return { pubkeyB64, privateKey };
}

function signFile(data: Buffer, id: Buffer, privateKey: KeyObject, trusted: string) {
  const hash = createHash("blake2b512").update(data).digest();
  const sig = sign(null, hash, privateKey);
  const global = sign(null, Buffer.concat([sig, Buffer.from(trusted, "utf8")]), privateKey);
  const sigLine = Buffer.concat([Buffer.from("ED"), id, sig]).toString("base64");
  return b64(
    `untrusted comment: signature from tauri secret key\n${sigLine}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`,
  );
}

const id = Buffer.from("0102030405060708", "hex");
const data = Buffer.from("update bundle");
const trusted = "timestamp:1\tfile:StudioManager.app.tar.gz\tversion:3.5.0";

describe("verify-update-signature", () => {
  it("prints key ids the way minisign and Tauri do (bytes reversed)", () => {
    expect(keyId(id)).toBe("0807060504030201");
    // The comment of the pubkey every installed app ships names the same id.
    const conf = JSON.parse(readFileSync(join(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    const [comment, keyLine] = Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf8").split("\n");
    expect(comment.endsWith(keyId(Buffer.from(keyLine, "base64").subarray(2, 10)))).toBe(true);
  });

  it("accepts a signature made with the pubkey's key", () => {
    const { pubkeyB64, privateKey } = throwawayKey(id);
    const r = verifySignature(data, signFile(data, id, privateKey, trusted), pubkeyB64);
    expect(r).toEqual({ keyId: "0807060504030201", trusted });
  });

  it("refuses a changed file", () => {
    const { pubkeyB64, privateKey } = throwawayKey(id);
    const sig = signFile(data, id, privateKey, trusted);
    expect(() => verifySignature(Buffer.from("other bundle"), sig, pubkeyB64)).toThrow(/does not match the file/);
  });

  it("names both key ids, in minisign order, when signed with another key", () => {
    const other = Buffer.from("1112131415161718", "hex");
    const { pubkeyB64 } = throwawayKey(id);
    const { privateKey } = throwawayKey(other);
    const sig = signFile(data, other, privateKey, trusted);
    expect(() => verifySignature(data, sig, pubkeyB64)).toThrow(
      "signed with key 1817161514131211, the pubkey is 0807060504030201",
    );
  });
});
