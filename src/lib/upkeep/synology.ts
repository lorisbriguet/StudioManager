/**
 * Setup helpers for the Synology DSM connection form. Rust (`connectors/
 * synology.rs`) reports the steps the form handles with fixed codes:
 * `untrusted_cert:<sha256 hex>`, `otp_required` / `otp_invalid`, and
 * `reenter_password` (the connection's address or certificate is not the one
 * the password was saved for: nothing was sent, the password is asked again).
 */

export type SynologyError =
  | { kind: "cert"; fingerprint: string }
  | { kind: "otp"; invalid: boolean }
  | { kind: "password" }
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
  if (message === "reenter_password") return { kind: "password" };
  return { kind: "other", message };
}

/** `AB:CD:…`, the way DSM and browsers show a certificate fingerprint. */
export function formatFingerprint(hex: string): string {
  return (hex.toUpperCase().match(/.{2}/g) ?? []).join(":");
}

/** The NAS a password is saved for: Rust sends it nowhere else. */
export interface SynologyBinding {
  host: string;
  port: number;
  /** The pinned certificate, or null for one the system trusts. */
  cert_fingerprint: string | null;
}

/**
 * The Keychain blob Rust reads: the password and the NAS it is for (host,
 * port, pin; a connection row that names another is refused), plus a one-time
 * code for one sign-in.
 */
export function synologySecret(password: string, nas: SynologyBinding, otpCode?: string): string {
  const code = otpCode?.replace(/\s/g, "");
  const blob = { password, host: nas.host, port: nas.port, cert_fingerprint: nas.cert_fingerprint };
  return JSON.stringify(code ? { ...blob, otp_code: code } : blob);
}

/** DSM's HTTPS port when the field is left empty. */
export const DEFAULT_SYNOLOGY_PORT = 5001;

/** The port typed, 1 to 65535 (empty: 5001), or null when it isn't one. */
export function parsePort(input: string): number | null {
  const s = input.trim();
  if (!s) return DEFAULT_SYNOLOGY_PORT;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

/** Same certificate fingerprint, whatever the case or colons. */
export function sameFingerprint(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/[:\s-]/g, "").toLowerCase();
  return norm(a) !== "" && norm(a) === norm(b);
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
