/**
 * Setup helpers for the Synology DSM connection form. Rust (`connectors/
 * synology.rs`) reports the two steps the form handles with fixed codes:
 * `untrusted_cert:<sha256 hex>` and `otp_required` / `otp_invalid`.
 */

export type SynologyError =
  | { kind: "cert"; fingerprint: string }
  | { kind: "otp"; invalid: boolean }
  | { kind: "other"; message: string };

const CERT_PREFIX = "untrusted_cert:";

/** What a failed `connection_test` asks of the user. */
export function parseSynologyError(e: unknown): SynologyError {
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith(CERT_PREFIX)) {
    const fingerprint = message.slice(CERT_PREFIX.length).trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(fingerprint)) return { kind: "cert", fingerprint };
  }
  if (message === "otp_required") return { kind: "otp", invalid: false };
  if (message === "otp_invalid") return { kind: "otp", invalid: true };
  return { kind: "other", message };
}

/** `AB:CD:…`, the way DSM and browsers show a certificate fingerprint. */
export function formatFingerprint(hex: string): string {
  return (hex.toUpperCase().match(/.{2}/g) ?? []).join(":");
}

/** The Keychain blob Rust reads: the password, plus a one-time code for one sign-in. */
export function synologySecret(password: string, otpCode?: string): string {
  const code = otpCode?.replace(/\s/g, "");
  return JSON.stringify(code ? { password, otp_code: code } : { password });
}

/** The host of whatever was pasted: no scheme, port or path (the port has its own field). */
export function normalizeHost(input: string): string {
  let h = input.trim().replace(/^[a-z]+:\/\//i, "");
  h = h.split(/[/?#]/)[0];
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  // One colon: host:port. More: a bare IPv6 address.
  if ((h.match(/:/g) ?? []).length === 1) h = h.split(":")[0];
  return h;
}
