#!/usr/bin/env node
// Checks a Tauri updater signature (.sig) against a pubkey, the way the
// installed app's updater does (RELEASING.md, step 4).
//
//   node scripts/verify-update-signature.mjs <file> <file.sig> [<pubkey> | @<file>]
//
// <pubkey> is a base64 string like plugins.updater.pubkey in tauri.conf.json,
// or @path to a file that holds one. Without it, the pubkey in
// src-tauri/tauri.conf.json is used.
// Exits 1 if the signature does not match. Uses Node's crypto only, and no
// other repo file: the release workflow checks out this file on its own.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, createPublicKey, verify } from "node:crypto";

// Both the pubkey and the .sig are base64 of a minisign text file.
const lines = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split("\n");

// A key id the way minisign and Tauri print it (in the pubkey comment): the
// 8 id bytes read as a little-endian number, so in reverse order.
export const keyId = (bytes) => Buffer.from(bytes).reverse().toString("hex").toUpperCase();

// Returns { keyId, trusted } or throws with the reason.
export function verifySignature(data, sigText, pubkeyB64) {
  const pub = Buffer.from(lines(pubkeyB64)[1] ?? "", "base64"); // "Ed" + key id (8) + key (32)
  const [, sigLine = "", trustedLine = "", globalLine = ""] = lines(sigText);
  const sig = Buffer.from(sigLine, "base64"); // algorithm (2) + key id (8) + signature (64)
  const trusted = trustedLine.replace(/^trusted comment: /, "");
  const globalSig = Buffer.from(globalLine, "base64");

  if (pub.length !== 42 || sig.length !== 74) throw new Error("malformed pubkey or signature");
  const pubId = keyId(pub.subarray(2, 10));
  const sigId = keyId(sig.subarray(2, 10));
  if (pubId !== sigId) throw new Error(`signed with key ${sigId}, the pubkey is ${pubId}`);

  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: pub.subarray(10).toString("base64url") },
    format: "jwk",
  });
  const alg = sig.subarray(0, 2).toString("latin1");
  // "ED" signs the BLAKE2b-512 hash of the file, "Ed" the file itself.
  const message = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;

  if (!verify(null, message, key, sig.subarray(10))) throw new Error("signature does not match the file");
  if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted, "utf8")]), key, globalSig)) {
    throw new Error("trusted comment signature does not match");
  }
  return { keyId: pubId, trusted };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, sigFile, pubkeyArg] = process.argv.slice(2);
  if (!file || !sigFile) {
    console.error("usage: verify-update-signature.mjs <file> <file.sig> [<pubkey> | @<file>]");
    process.exit(2);
  }
  const conf = new URL("../src-tauri/tauri.conf.json", import.meta.url);
  const pubkeyB64 = !pubkeyArg
    ? JSON.parse(readFileSync(conf, "utf8")).plugins.updater.pubkey
    : pubkeyArg.startsWith("@") ? readFileSync(pubkeyArg.slice(1), "utf8") : pubkeyArg;
  try {
    const r = verifySignature(readFileSync(file), readFileSync(sigFile, "utf8"), pubkeyB64);
    // The release workflow reads the trusted comment at the end of this line.
    console.log(`signature OK (key ${r.keyId}; ${r.trusted})`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
