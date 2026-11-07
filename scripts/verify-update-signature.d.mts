// Types for verify-update-signature.mjs, so tests can import it.
export function keyId(bytes: Uint8Array): string;
export function verifySignature(
  data: Uint8Array,
  sigText: string,
  pubkeyB64: string,
): { keyId: string; trusted: string };
