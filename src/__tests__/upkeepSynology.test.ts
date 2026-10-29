import { describe, it, expect } from "vitest";
import {
  formatFingerprint, normalizeHost, parseSynologyError, synologySecret,
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

  it("builds the Keychain secret, with the code only when given", () => {
    expect(JSON.parse(synologySecret("pw"))).toEqual({ password: "pw" });
    expect(JSON.parse(synologySecret("pw", " 123 456 "))).toEqual({ password: "pw", otp_code: "123456" });
  });

  it("keeps only the host of a pasted address", () => {
    expect(normalizeHost(" https://nas.local:5001/ ")).toBe("nas.local");
    expect(normalizeHost("192.168.1.20")).toBe("192.168.1.20");
    expect(normalizeHost("http://192.168.1.20/webman/index.cgi")).toBe("192.168.1.20");
    expect(normalizeHost("[fe80::1]:5001")).toBe("[fe80::1]");
    expect(normalizeHost("fe80::1")).toBe("fe80::1");
  });
});
