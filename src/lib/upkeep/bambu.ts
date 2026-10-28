/**
 * Setup helpers for the Bambu Lab cloud connection form. Rust
 * (`connectors/bambu.rs`) reports the steps the form handles with fixed codes:
 * `code_required` / `code_invalid` (the code Bambu emails) and `token_expired`
 * (sign in again).
 */

export type BambuError =
  | { kind: "code"; invalid: boolean }
  | { kind: "signin" }
  | { kind: "other"; message: string };

export const BAMBU_REGIONS = ["global", "china"] as const;
export type BambuRegion = (typeof BAMBU_REGIONS)[number];

/** What a failed `connection_test` or sync asks of the user. */
export function parseBambuError(e: unknown): BambuError {
  const message = e instanceof Error ? e.message : String(e);
  if (message === "code_required") return { kind: "code", invalid: false };
  if (message === "code_invalid") return { kind: "code", invalid: true };
  if (message === "token_expired") return { kind: "signin" };
  return { kind: "other", message };
}

/**
 * The Keychain blob for one sign-in with the password. Rust replaces it with
 * Bambu's tokens (or nothing) after that sign-in: the password is never kept.
 */
export function bambuPasswordSecret(password: string): string {
  return JSON.stringify({ password });
}

/** The Keychain blob for one sign-in with the emailed code. */
export function bambuCodeSecret(code: string): string {
  return JSON.stringify({ code: code.replace(/\s/g, "") });
}
