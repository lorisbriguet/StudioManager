#!/usr/bin/env node
// Checks a Tauri updater signature (.sig) against a pubkey, the way the
// installed app's updater does (RELEASING.md, step 4).
//
//   node scripts/verify-update-signature.mjs <file> <file.sig> [<pubkey> | @<file>]
//
// <pubkey> is a base64 string like plugins.updater.pubkey in tauri.conf.json,
// or @path to a file that holds one. Without it, the pubkey in
// src-tauri/tauri.conf.json is used.
// Exits 1 if the signature does not match. Uses Node's crypto only.

import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";

const [file, sigFile, pubkeyArg] = process.argv.slice(2);
if (!file || !sigFile) {
  console.error("usage: verify-update-signature.mjs <file> <file.sig> [<pubkey> | @<file>]");
  process.exit(2);
}
const conf = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const pubkeyB64 = !pubkeyArg
  ? JSON.parse(readFileSync(conf, "utf8")).plugins.updater.pubkey
  : pubkeyArg.startsWith("@") ? readFileSync(pubkeyArg.slice(1), "utf8") : pubkeyArg;

// Both the pubkey and the .sig are base64 of a minisign text file.
const lines = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split("\n");
const fail = (msg) => { console.error(msg); process.exit(1); };

const pub = Buffer.from(lines(pubkeyB64)[1], "base64"); // "Ed" + key id (8) + key (32)
const [, sigLine, trustedLine, globalLine] = lines(readFileSync(sigFile, "utf8"));
const sig = Buffer.from(sigLine, "base64"); // algorithm (2) + key id (8) + signature (64)
const trusted = trustedLine.replace(/^trusted comment: /, "");
const globalSig = Buffer.from(globalLine, "base64");

if (pub.length !== 42 || sig.length !== 74) fail("malformed pubkey or signature");
if (!pub.subarray(2, 10).equals(sig.subarray(2, 10))) {
  fail(`signed with key ${sig.subarray(2, 10).toString("hex")}, the pubkey is ${pub.subarray(2, 10).toString("hex")}`);
}

const key = createPublicKey({
  key: { kty: "OKP", crv: "Ed25519", x: pub.subarray(10).toString("base64url") },
  format: "jwk",
});
const alg = sig.subarray(0, 2).toString("latin1");
const data = readFileSync(file);
// "ED" signs the BLAKE2b-512 hash of the file, "Ed" the file itself.
const message = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;

if (!verify(null, message, key, sig.subarray(10))) fail("signature does not match the file");
if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted, "utf8")]), key, globalSig)) {
  fail("trusted comment signature does not match");
}
console.log(`signature OK (key ${pub.subarray(2, 10).toString("hex")}; ${trusted})`);
