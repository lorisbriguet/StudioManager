import { describe, it, expect } from "vitest";
import {
  formatFingerprint, normalizeHost, parsePort, parseSynologyError, sameFingerprint, synologySecret,
} from "../lib/upkeep/synology";

const FP = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("Synology setup helpers", () => {
  it("recognises an untrusted certificate and keeps its fingerprint", () => {
    expect(parseSynologyError(`untrusted_cert:${FP}`)).toEqual({ kind: "cert", fingerprint: FP });
    expect(parseSynologyError(new Error(`untrusted_cert:${FP}`))).toEqual({ kind: "cert", fingerprint: FP });
  });

  it("recognises a needed or wrong 2-step code", () => {
    expect(parseSynologyError("otp_required")).toEqual({ kind: "otp", invalid: false });
    expect(parseSynologyError("otp_invalid")).toEqual({ kind: "otp", invalid: true });
  });

  it("recognises a password to type again (the row and the secret's NAS differ)", () => {
    expect(parseSynologyError("reenter_password")).toEqual({ kind: "password" });
  });

  it("passes other errors through", () => {
    expect(parseSynologyError("DSM refused the account name or password")).toEqual({
      kind: "other", message: "DSM refused the account name or password",
    });
    // A malformed fingerprint is not offered for trust.
    expect(parseSynologyError("untrusted_cert:xyz").kind).toBe("other");
  });

  it("shows a fingerprint as colon-separated pairs", () => {
    expect(formatFingerprint(FP)).toBe(
      "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD"
    );
  });

  it("builds the Keychain secret bound to its NAS, with the code only when given", () => {
    const nas = { host: "nas.local", port: 5001, cert_fingerprint: null };
    expect(JSON.parse(synologySecret("pw", nas))).toEqual({
      password: "pw", host: "nas.local", port: 5001, cert_fingerprint: null,
    });
    expect(JSON.parse(synologySecret("pw", { ...nas, cert_fingerprint: FP }, " 123 456 "))).toEqual({
      password: "pw", host: "nas.local", port: 5001, cert_fingerprint: FP, otp_code: "123456",
    });
  });

  it("reads a port of 1 to 65535, empty meaning DSM's 5001", () => {
    expect(parsePort("")).toBe(5001);
    expect(parsePort(" 5443 ")).toBe(5443);
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
    for (const bad of ["0", "65536", "70000", "-1", "50.5", "abc", "1e3"]) expect(parsePort(bad)).toBeNull();
  });

  it("compares fingerprints whatever their formatting", () => {
    expect(sameFingerprint(FP, formatFingerprint(FP))).toBe(true);
    expect(sameFingerprint(FP, "cd".repeat(32))).toBe(false);
    expect(sameFingerprint(FP, null)).toBe(false);
    expect(sameFingerprint(null, null)).toBe(false);
  });

  it("keeps only the host of a pasted address", () => {
    expect(normalizeHost(" https://nas.local:5001/ ")).toBe("nas.local");
    expect(normalizeHost("192.168.1.20")).toBe("192.168.1.20");
    expect(normalizeHost("http://192.168.1.20/webman/index.cgi")).toBe("192.168.1.20");
    expect(normalizeHost("[fe80::1]:5001")).toBe("[fe80::1]");
    expect(normalizeHost("fe80::1")).toBe("fe80::1");
  });
});
